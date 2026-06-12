import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * POST /api/stripe/create-setup-intent — begin saving a homeowner's card.
 *
 * Auth (requireSelfOrOrgStaff): the homeowner themselves, or org staff
 * (owner/admin/manager + organization_id in the body) acting on a homeowner who
 * belongs to their org. Previously this route had NO auth — these tests are the
 * regression guard for that hole.
 *
 * Per-file mock of @/lib/stripe (replaces the global mock for this file): keep
 * getStripe throwing and stub the two Stripe-touching helpers the route calls
 * (getOrCreateStripeCustomer, createSetupIntent) so auth rejections short-circuit
 * before any Stripe call and the happy paths run against the real DB.
 */
vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...actual,
    getStripe: () => {
      throw new Error('getStripe() called directly in a test');
    },
    getOrCreateStripeCustomer: vi.fn(async (_email: string, _name: string, existing?: string | null) => ({
      id: existing ?? 'cus_setupintent_test',
      object: 'customer',
    })),
    createSetupIntent: vi.fn(async (customerId: string) => ({
      id: 'seti_test_1',
      object: 'setup_intent',
      client_secret: 'seti_test_1_secret_abc',
      customer: customerId,
      status: 'requires_payment_method',
    })),
  };
});

import { POST } from './route';
import { getOrCreateStripeCustomer, createSetupIntent } from '@/lib/stripe';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/stripe/create-setup-intent', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalStripeEnabled: string | undefined;

  beforeEach(async () => {
    originalStripeEnabled = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    vi.mocked(getOrCreateStripeCustomer).mockClear();
    vi.mocked(createSetupIntent).mockClear();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalStripeEnabled;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 404 when STRIPE_ENABLED is false', async () => {
    process.env.STRIPE_ENABLED = 'false';
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(404);
    expect(vi.mocked(createSetupIntent)).not.toHaveBeenCalled();
  });

  it('returns 401 with no Authorization header (the old unauthenticated hole)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(401);
    expect(vi.mocked(getOrCreateStripeCustomer)).not.toHaveBeenCalled();
  });

  it('returns 401 with a garbage token', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader('not-a-real-token'),
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(401);
    expect(vi.mocked(getOrCreateStripeCustomer)).not.toHaveBeenCalled();
  });

  it('returns 400 when staff omit organization_id', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(400);
    expect(vi.mocked(getOrCreateStripeCustomer)).not.toHaveBeenCalled();
  });

  it('rejects a cleaner acting on a homeowner (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { homeowner_id: org.homeowner.userId, organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(getOrCreateStripeCustomer)).not.toHaveBeenCalled();
  });

  it('rejects cross-org staff (403 when not a member of the claimed org)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { homeowner_id: org.homeowner.userId, organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(getOrCreateStripeCustomer)).not.toHaveBeenCalled();
  });

  it("rejects staff acting on another org's homeowner (404)", async () => {
    // org2's admin is a real admin of org2, but the homeowner belongs to org1 only.
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { homeowner_id: org.homeowner.userId, organization_id: org2.organizationId },
    });
    expect(status).toBe(404);
    expect(vi.mocked(getOrCreateStripeCustomer)).not.toHaveBeenCalled();
  });

  it('homeowner self-service happy path (no organization_id needed)', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      client_secret: string;
      customer_id: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.client_secret).toBe('seti_test_1_secret_abc');
    expect(vi.mocked(createSetupIntent)).toHaveBeenCalledTimes(1);

    // The minted customer id is persisted on the profile.
    const db = createTestSupabaseClient();
    const { data: profile } = await db
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', org.homeowner.userId)
      .single();
    expect((profile as { stripe_customer_id: string }).stripe_customer_id).toBe('cus_setupintent_test');
  });

  it('admin staff happy path with organization_id', async () => {
    const { status, body } = await callRoute<{ success: boolean; client_secret: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { homeowner_id: org.homeowner.userId, organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.client_secret).toBe('seti_test_1_secret_abc');
  });
});
