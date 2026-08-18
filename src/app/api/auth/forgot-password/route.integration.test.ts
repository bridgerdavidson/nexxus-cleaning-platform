import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the GoTrue-touching reset trigger so we control its outcome. The route's
// alert orchestration + the platform_alerts de-dupe/write run for real against the
// local DB.
vi.mock('@/lib/auth/passwordReset', () => ({
  triggerPasswordReset: vi.fn(async () => ({ error: null })),
}));

// Unconfigured by default so the pre-existing tests keep the GoTrue fallback
// path; the org-branded describe at the bottom flips emailConfigured per test.
vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: vi.fn(async () => undefined),
  emailConfigured: vi.fn(() => false),
}));

import { POST } from './route';
import { triggerPasswordReset } from '@/lib/auth/passwordReset';
import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { callRoute } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const admin = createTestSupabaseClient();
const ALERT_TYPE = 'auth_email_send_failure';

const sendFailure = {
  status: 500,
  code: 'unexpected_failure',
  message: 'Error sending recovery email',
  name: 'AuthApiError',
};
const rateLimit = {
  status: 429,
  code: 'over_email_send_rate_limit',
  message: 'Email rate limit exceeded',
  name: 'AuthApiError',
};

type ResetResult = Awaited<ReturnType<typeof triggerPasswordReset>>;

async function openAlerts() {
  const { data } = await admin
    .from('platform_alerts')
    .select('id, occurrences, severity, details')
    .eq('alert_type', ALERT_TYPE)
    .is('resolved_at', null);
  return (data ?? []) as Array<{
    id: string;
    occurrences: number;
    severity: string;
    details: Record<string, unknown>;
  }>;
}

async function clearAlerts() {
  await admin.from('platform_alerts').delete().eq('alert_type', ALERT_TYPE);
}

describe('POST /api/auth/forgot-password', () => {
  beforeEach(async () => {
    await clearAlerts();
    vi.mocked(triggerPasswordReset).mockReset();
    vi.mocked(triggerPasswordReset).mockResolvedValue({ error: null } as ResetResult);
  });

  afterEach(async () => {
    await clearAlerts();
  });

  it('returns 400 for a missing email and records no alert', async () => {
    const { status } = await callRoute(POST, { method: 'POST', body: {} });
    expect(status).toBe(400);
    expect(await openAlerts()).toHaveLength(0);
  });

  it('returns 400 for a malformed email', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { email: 'not-an-email' },
    });
    expect(status).toBe(400);
  });

  it('returns generic ok and records NO alert when the send succeeds', async () => {
    const { status, body } = await callRoute<{ ok: boolean }>(POST, {
      method: 'POST',
      body: { email: 'user@example.com', redirectTo: 'http://localhost:3000/reset-password' },
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(await openAlerts()).toHaveLength(0);
  });

  it('returns the SAME generic ok (no leak) but records a platform alert when the send fails', async () => {
    vi.mocked(triggerPasswordReset).mockResolvedValueOnce({ error: sendFailure } as ResetResult);

    const { status, body } = await callRoute<{ ok: boolean }>(POST, {
      method: 'POST',
      body: { email: 'victim@example.com', redirectTo: 'http://localhost:3000/reset-password' },
    });

    // Response is byte-identical to the success case — the user cannot tell.
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const alerts = await openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].details.email).toBe('victim@example.com');
  });

  it('does NOT alert on a rate-limit error', async () => {
    vi.mocked(triggerPasswordReset).mockResolvedValueOnce({ error: rateLimit } as ResetResult);

    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { email: 'user@example.com', redirectTo: 'http://localhost:3000/reset-password' },
    });

    expect(status).toBe(200);
    expect(await openAlerts()).toHaveLength(0);
  });

  it('folds repeated failures into one incident row (occurrences increments)', async () => {
    vi.mocked(triggerPasswordReset).mockResolvedValue({ error: sendFailure } as ResetResult);

    await callRoute(POST, {
      method: 'POST',
      body: { email: 'a@example.com', redirectTo: 'http://localhost:3000/reset-password' },
    });
    await callRoute(POST, {
      method: 'POST',
      body: { email: 'b@example.com', redirectTo: 'http://localhost:3000/reset-password' },
    });

    const alerts = await openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].occurrences).toBe(2);
  });
});

/**
 * Org-branded recovery delivery: with SMTP configured the route must mint the
 * link via generateLink and send through the app transport with the user's org
 * as the sender, never GoTrue's mailer. Anti-enumeration and the alerting
 * contract must survive the new path.
 */
describe('POST /api/auth/forgot-password (org-branded delivery)', () => {
  let org: TestOrgFixture | null = null;

  const ACTION_LINK =
    'http://127.0.0.1:54321/auth/v1/verify?token=tok&type=recovery&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Freset-password';

  beforeEach(async () => {
    await clearAlerts();
    vi.mocked(triggerPasswordReset).mockReset();
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    vi.mocked(emailConfigured).mockReturnValue(true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(emailConfigured).mockReturnValue(false);
    await org?.cleanup();
    org = null;
    await clearAlerts();
  });

  it("sends via generateLink with the user's org as sender; GoTrue trigger never called", async () => {
    org = await withTestOrg();
    vi.spyOn(supabaseAdmin.auth.admin, 'generateLink')
       
      .mockResolvedValue({
        data: { properties: { action_link: ACTION_LINK }, user: { id: org.cleaner.userId } },
        error: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

    const { status, body } = await callRoute<{ ok: boolean }>(POST, {
      method: 'POST',
      body: { email: org.cleaner.email, redirectTo: 'http://localhost:3000/reset-password' },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(triggerPasswordReset).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    const { data: orgRow } = await admin
      .from('organizations')
      .select('name')
      .eq('id', org.organizationId)
      .single();
    const orgName = (orgRow as { name: string }).name;
    expect(sent.to).toBe(org.cleaner.email);
    expect(sent.fromName).toBe(orgName);
    expect(sent.subject).toBe('Reset your password');
    expect(sent.html).toContain(orgName);
    expect(sent.text).toContain(ACTION_LINK);
    expect(await openAlerts()).toHaveLength(0);
  });

  it('stays silent for an unknown email (anti-enumeration): generic ok, no send, no alert', async () => {
    vi.spyOn(supabaseAdmin.auth.admin, 'generateLink')
       
      .mockResolvedValue({
        data: { properties: null, user: null },
        error: { status: 404, code: 'user_not_found', message: 'User not found', name: 'AuthApiError' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

    const { status, body } = await callRoute<{ ok: boolean }>(POST, {
      method: 'POST',
      body: { email: 'nobody@example.com', redirectTo: 'http://localhost:3000/reset-password' },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await openAlerts()).toHaveLength(0);
  });

  it('records a platform alert when the branded send fails, response stays generic ok', async () => {
    org = await withTestOrg();
    vi.spyOn(supabaseAdmin.auth.admin, 'generateLink')
       
      .mockResolvedValue({
        data: { properties: { action_link: ACTION_LINK }, user: { id: org.cleaner.userId } },
        error: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    vi.mocked(sendEmail).mockRejectedValue(new Error('smtp down'));

    const { status, body } = await callRoute<{ ok: boolean }>(POST, {
      method: 'POST',
      body: { email: org.cleaner.email, redirectTo: 'http://localhost:3000/reset-password' },
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const alerts = await openAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].details.code).toBe('smtp_send_failed');
    expect(alerts[0].details.message).toBe('smtp down');
  });
});
