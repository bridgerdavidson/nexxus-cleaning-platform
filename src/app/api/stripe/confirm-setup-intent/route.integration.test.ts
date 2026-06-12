import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * POST /api/stripe/confirm-setup-intent — attach a confirmed SetupIntent's payment
 * method and record the Customer on the homeowner's profile.
 *
 * Auth (requireSelfOrOrgStaff): the homeowner themselves, or org staff
 * (owner/admin/manager + organization_id) acting on a homeowner of their org.
 * Previously this route had NO auth and would overwrite ANY profile's
 * stripe_customer_id with an attacker-supplied SetupIntent's customer — these
 * tests are the regression guard for both the auth hole and the repoint hole.
 *
 * Per-file mock of @/lib/stripe: getStripe returns a fake whose
 * setupIntents.retrieve serves `globalThis.__confirmSiFake` (set per test);
 * attachPaymentMethodToCustomer is stubbed so we can assert it was (not) called.
 */
vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...actual,
    getStripe: () =>
      ({
        setupIntents: {
          retrieve: async () =>
            (globalThis as { __confirmSiFake?: unknown }).__confirmSiFake as Stripe.SetupIntent,
        },
      }) as unknown as Stripe,
    attachPaymentMethodToCustomer: vi.fn(async (paymentMethodId: string) => ({
      id: paymentMethodId,
      object: 'payment_method',
    })),
  };
});

import { POST } from './route';
import { attachPaymentMethodToCustomer } from '@/lib/stripe';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

declare global {
  var __confirmSiFake: unknown;
}

function setSiFake(args: { status?: string; paymentMethod?: string | null; customer?: string | null }) {
  globalThis.__confirmSiFake = {
    id: 'seti_test_1',
    object: 'setup_intent',
    status: args.status ?? 'succeeded',
    payment_method: args.paymentMethod === undefined ? 'pm_test_1' : args.paymentMethod,
    customer: args.customer === undefined ? 'cus_si_test' : args.customer,
    last_setup_error: null,
  };
}

describe('POST /api/stripe/confirm-setup-intent', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalStripeEnabled: string | undefined;

  beforeEach(async () => {
    originalStripeEnabled = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    setSiFake({});
    vi.mocked(attachPaymentMethodToCustomer).mockClear();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalStripeEnabled;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header (the old unauthenticated hole)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { setup_intent_id: 'seti_test_1', homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(401);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();
  });

  it('returns 400 when setup_intent_id is missing', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(400);
  });

  it("rejects staff acting on another org's homeowner (404)", async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: {
        setup_intent_id: 'seti_test_1',
        homeowner_id: org.homeowner.userId,
        organization_id: org2.organizationId,
      },
    });
    expect(status).toBe(404);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();
  });

  it('returns 400 when the SetupIntent has not succeeded', async () => {
    setSiFake({ status: 'requires_action' });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { setup_intent_id: 'seti_test_1', homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(400);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();
  });

  it('homeowner self-service happy path: attaches and records the customer (first save)', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      customer_id: string;
      payment_method_id: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { setup_intent_id: 'seti_test_1', homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.customer_id).toBe('cus_si_test');
    expect(body.payment_method_id).toBe('pm_test_1');
    expect(vi.mocked(attachPaymentMethodToCustomer)).toHaveBeenCalledWith('pm_test_1', 'cus_si_test');

    const db = createTestSupabaseClient();
    const { data: profile } = await db
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', org.homeowner.userId)
      .single();
    expect((profile as { stripe_customer_id: string }).stripe_customer_id).toBe('cus_si_test');
  });

  it('admin staff happy path with organization_id', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        setup_intent_id: 'seti_test_1',
        homeowner_id: org.homeowner.userId,
        organization_id: org.organizationId,
      },
    });
    expect(status).toBe(200);
    expect(vi.mocked(attachPaymentMethodToCustomer)).toHaveBeenCalledTimes(1);
  });

  it("409s when the SetupIntent's customer differs from the profile's saved customer (no repoint)", async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_already_on_file' })
      .eq('id', org.homeowner.userId);
    setSiFake({ customer: 'cus_attacker_controlled' });

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { setup_intent_id: 'seti_test_1', homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(409);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();

    // The profile's payment identity was NOT repointed.
    const { data: profile } = await db
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', org.homeowner.userId)
      .single();
    expect((profile as { stripe_customer_id: string }).stripe_customer_id).toBe('cus_already_on_file');
  });

  it('matching customer on file is fine (attaches, keeps the id)', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_si_test' })
      .eq('id', org.homeowner.userId);

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { setup_intent_id: 'seti_test_1', homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(200);
    expect(vi.mocked(attachPaymentMethodToCustomer)).toHaveBeenCalledTimes(1);
  });
});
