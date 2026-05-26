import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// SaaS billing Stripe calls go through @/lib/stripe/billing (getStripe(), stubbed to throw).
// Mock the wrappers so the orchestration runs against the real DB with controlled Stripe data.
vi.mock('@/lib/stripe/billing', () => ({
  createStripeBillingCustomer: vi.fn(async () => ({ id: `cus_test_${crypto.randomUUID()}` })),
  createStripeSubscription: vi.fn(async () => ({
    id: `sub_test_${crypto.randomUUID()}`,
    status: 'active',
    latest_invoice: { payment_intent: { client_secret: 'pi_secret_test' } },
  })),
  cancelStripeSubscription: vi.fn(async () => ({ id: 'sub_test', status: 'canceled' })),
  createBillingPortalSession: vi.fn(async () => ({ url: 'https://billing.stripe.test/session' })),
}));

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';

describe('POST /api/stripe/billing/subscriptions/start', () => {
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
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organization_id: org.organizationId, price_id: 'price_123' },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, price_id: 'price_123' },
    });
    expect(status).toBe(403);
  });

  it('returns 404 when Stripe is disabled', async () => {
    process.env.STRIPE_ENABLED = 'false';
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, price_id: 'price_123' },
    });
    expect(status).toBe(404);
  });

  it('returns 400 when price_id is missing (after auth passes)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(400);
  });

  it('creates the billing customer + subscription and mirrors org state', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      subscription_id: string;
      status: string;
      client_secret: string | null;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, price_id: 'price_123' },
    });
    expect(status).toBe(200);
    expect(body.subscription_id).toMatch(/^sub_test_/);
    expect(body.status).toBe('active');
    expect(body.client_secret).toBe('pi_secret_test');

    const db = createTestSupabaseClient();
    const { data: o } = await db
      .from('organizations')
      .select('stripe_customer_id, subscription_id, subscription_status')
      .eq('id', org.organizationId)
      .single();
    const orgRow = o as { stripe_customer_id: string; subscription_id: string; subscription_status: string };
    expect(orgRow.stripe_customer_id).toMatch(/^cus_test_/);
    expect(orgRow.subscription_id).toBe(body.subscription_id);
    expect(orgRow.subscription_status).toBe('active');
  });
});
