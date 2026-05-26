import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/stripe/billing', () => ({
  createStripeBillingCustomer: vi.fn(async () => ({ id: `cus_test_${crypto.randomUUID()}` })),
  createStripeSubscription: vi.fn(async () => ({ id: 'sub_test', status: 'active' })),
  cancelStripeSubscription: vi.fn(async () => ({ id: 'sub_test', status: 'canceled' })),
  createBillingPortalSession: vi.fn(async () => ({ url: 'https://billing.stripe.test/session' })),
}));

import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const BASE = 'http://test.local/api/stripe/billing/portal-link';

describe('GET /api/stripe/billing/portal-link', () => {
  let org: TestOrgFixture;
  let originalEnabled: string | undefined;

  beforeEach(async () => {
    originalEnabled = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalEnabled;
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: `${BASE}?organization_id=${org.organizationId}`,
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.cleaner.accessToken),
      url: `${BASE}?organization_id=${org.organizationId}`,
    });
    expect(status).toBe(403);
  });

  it('returns a portal URL for an admin and ensures the billing customer exists', async () => {
    const { status, body } = await callRoute<{ success: boolean; url: string }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: `${BASE}?organization_id=${org.organizationId}&return_url=https://app.test/admin-dashboard`,
    });
    expect(status).toBe(200);
    expect(body.url).toBe('https://billing.stripe.test/session');

    const db = createTestSupabaseClient();
    const { data: o } = await db
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', org.organizationId)
      .single();
    expect((o as { stripe_customer_id: string }).stripe_customer_id).toMatch(/^cus_test_/);
  });
});
