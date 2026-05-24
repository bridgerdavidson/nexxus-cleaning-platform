import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getOrCreateStripeCustomer: vi.fn(async () => ({ id: 'cus_sess' })),
  createHomeownerCustomerSession: vi.fn(async () => ({ client_secret: 'cuss_secret_123' })),
}));

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/stripe/customer-session', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, { method: 'POST', body: {} });
    expect(status).toBe(401);
  });

  it('creates a CustomerSession for the authenticated caller and persists the customer id', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      customer_session_client_secret: string;
      customer_id: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {},
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.customer_session_client_secret).toBe('cuss_secret_123');
    expect(body.customer_id).toBe('cus_sess');

    const db = createTestSupabaseClient();
    const { data: ho } = await db
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', org.homeowner.userId)
      .single();
    expect((ho as { stripe_customer_id: string }).stripe_customer_id).toBe('cus_sess');
  });
});
