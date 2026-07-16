import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_link' })),
}));
vi.mock('@/lib/stripe/setup-intents', () => ({
  createCardSetupIntent: vi.fn(async () => ({ id: 'seti_link' })),
}));
// Unconfigured by default so the pre-email tests keep their copy-link behavior;
// the delivery describe below flips emailConfigured per test.
vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: vi.fn(async () => undefined),
  emailConfigured: vi.fn(() => false),
}));

import { emailConfigured, sendEmail } from '@/lib/email/sendEmail';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addManagerToOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/billing/card-links', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(403);
  });

  it('404 when the homeowner is not associated with the org', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org2.homeowner.userId },
    });
    expect(status).toBe(404);
  });

  it('creates a pending card link with a token + SetupIntent and persists it', async () => {
    const { status, body } = await callRoute<{ success: boolean; token: string; url: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.url).toContain(`/billing/add-card?t=${body.token}`);

    const db = createTestSupabaseClient();
    const { data: links } = await db
      .from('homeowner_payment_links')
      .select('status, setup_intent_id, homeowner_id, created_by')
      .eq('token', body.token);
    expect(links).toHaveLength(1);
    const link = links![0] as {
      status: string;
      setup_intent_id: string;
      homeowner_id: string;
      created_by: string;
    };
    expect(link.status).toBe('pending');
    expect(link.setup_intent_id).toBe('seti_link');
    expect(link.homeowner_id).toBe(org.homeowner.userId);

    // homeowner customer id persisted
    const { data: ho } = await db
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', org.homeowner.userId)
      .single();
    expect((ho as { stripe_customer_id: string }).stripe_customer_id).toBe('cus_link');
  });
});

describe('POST /api/billing/card-links email delivery', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;
  let originalAppUrl: string | undefined;
  let originalPublicAppUrl: string | undefined;

  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    originalAppUrl = process.env.APP_URL;
    originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    process.env.APP_URL = 'https://app.nexxus.test';
    vi.mocked(emailConfigured).mockReturnValue(true);
    vi.mocked(sendEmail).mockClear();
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    restoreEnv('APP_URL', originalAppUrl);
    restoreEnv('NEXT_PUBLIC_APP_URL', originalPublicAppUrl);
    vi.mocked(emailConfigured).mockReturnValue(false);
    await org.cleanup();
  });

  const create = (extra: Record<string, unknown> = {}) =>
    callRoute<{ success: boolean; token: string; url: string; delivered: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId, ...extra },
    });

  it('emails the homeowner a link built from APP_URL (not the request origin)', async () => {
    const { status, body } = await create();
    expect(status).toBe(200);
    expect(body.delivered).toBe('email');

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    expect(sent.to).toBe(org.homeowner.email);
    expect(sent.subject).toContain('Update your payment method');
    const emailedUrl = `https://app.nexxus.test/billing/add-card?t=${body.token}`;
    expect(sent.html).toContain(emailedUrl);
    expect(sent.text).toContain(emailedUrl);
    // The signed-in alternative also builds from APP_URL.
    expect(sent.html).toContain('https://app.nexxus.test/app/homeowner-dashboard/account/payment-methods');
    // The copy URL keeps the request origin for the operator's own browser.
    expect(body.url).toContain(`/billing/add-card?t=${body.token}`);
    expect(body.url).not.toContain('app.nexxus.test');
  });

  it('degrades to delivered: copy when the send fails, without failing the request', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('SMTP down'));
    const { status, body } = await create();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.delivered).toBe('copy');
    // The link row still exists so the operator can share it manually.
    const db = createTestSupabaseClient();
    const { data: links } = await db.from('homeowner_payment_links').select('status').eq('token', body.token);
    expect(links).toHaveLength(1);
  });

  it('returns delivered: copy and sends nothing when SMTP is unconfigured', async () => {
    vi.mocked(emailConfigured).mockReturnValue(false);
    const { status, body } = await create();
    expect(status).toBe(200);
    expect(body.delivered).toBe('copy');
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it('returns delivered: copy and sends nothing when APP_URL is missing (no trusted base)', async () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { status, body } = await create();
    expect(status).toBe(200);
    expect(body.delivered).toBe('copy');
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it("honors an explicit deliver: 'copy' even when email is configured", async () => {
    const { status, body } = await create({ deliver: 'copy' });
    expect(status).toBe(200);
    expect(body.delivered).toBe('copy');
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it('sends the urgent variant when appointment_id names a failed charge (amount + date included)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
      scheduledDate: '2026-06-24',
    });
    const db = createTestSupabaseClient();
    await db.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);

    const { status, body } = await create({ appointment_id: appt.id });
    expect(status).toBe(200);
    expect(body.delivered).toBe('email');
    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    expect(sent.subject).toContain('Action needed');
    expect(sent.html).toContain('June 24');
    expect(sent.html).toContain('$100.00');
  });

  it('falls back to the routine email when the appointment has not actually failed', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { body } = await create({ appointment_id: appt.id });
    expect(body.delivered).toBe('email');
    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    expect(sent.subject).toContain('Update your payment method');
    expect(sent.subject).not.toContain('Action needed');
  });

  it("ignores a cross-tenant appointment_id (routine email, identical response, no leak)", async () => {
    const org2 = await withTestOrg();
    try {
      const foreign = await createTestAppointment({
        organizationId: org2.organizationId,
        cleanerId: org2.cleaner.userId,
        homeownerId: org2.homeowner.userId,
      });
      const db = createTestSupabaseClient();
      await db.from('appointments').update({ authorization_status: 'failed' }).eq('id', foreign.id);

      const { status, body } = await create({ appointment_id: foreign.id });
      expect(status).toBe(200);
      expect(body.delivered).toBe('email');
      const sent = vi.mocked(sendEmail).mock.calls[0][0];
      expect(sent.subject).toContain('Update your payment method');
      expect(sent.subject).not.toContain('Action needed');
    } finally {
      await org2.cleanup();
    }
  });
});

describe('POST /api/billing/card-links manager gate (can_manage_payments)', () => {
  let mgrOrg: TestOrgFixture | null = null;
  let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    if (mgr) { await mgr.cleanup(); mgr = null; }
    if (mgrOrg) { await mgrOrg.cleanup(); mgrOrg = null; }
  });

  it('403 for a manager without can_manage_payments', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: false });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: mgrOrg.organizationId, homeowner_id: mgrOrg.homeowner.userId },
    });
    expect(status).toBe(403);
  });

  it('lets a manager WITH can_manage_payments past the auth gate', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: true });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: mgrOrg.organizationId, homeowner_id: mgrOrg.homeowner.userId },
    });
    expect(status).not.toBe(401);
    expect(status).not.toBe(403);
  });
});
