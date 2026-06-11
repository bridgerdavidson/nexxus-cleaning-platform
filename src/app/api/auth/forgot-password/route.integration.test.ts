import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the GoTrue-touching reset trigger so we control its outcome. The route's
// alert orchestration + the platform_alerts de-dupe/write run for real against the
// local DB.
vi.mock('@/lib/auth/passwordReset', () => ({
  triggerPasswordReset: vi.fn(async () => ({ error: null })),
}));

import { POST } from './route';
import { triggerPasswordReset } from '@/lib/auth/passwordReset';
import { callRoute } from '../../../../../tests/helpers/auth';
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
