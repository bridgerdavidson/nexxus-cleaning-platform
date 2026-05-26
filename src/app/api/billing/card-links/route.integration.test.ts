import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_link' })),
}));
vi.mock('@/lib/stripe/setup-intents', () => ({
  createCardSetupIntent: vi.fn(async () => ({ id: 'seti_link' })),
}));

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
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
