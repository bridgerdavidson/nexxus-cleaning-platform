import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * POST /api/stripe/org/create-setup-intent — begin saving the org's company card.
 *
 * Auth: requireOrgPaymentsAuth (owner/admin always; manager only with can_manage_payments).
 * Happy path ensures the org's self-pay Customer exists and persists
 * organizations.stripe_self_pay_customer_id.
 *
 * Per-file mock of @/lib/stripe (REPLACES the global mock for this file): re-stub getStripe to
 * throw (as the global setup does) and stub the two Stripe-touching helpers this route calls
 * (getOrCreateStripeCustomer, createSetupIntent) so role-rejections short-circuit before any Stripe
 * call and the admin happy path runs against the real DB. Role-rejection tests assert the stubs
 * were NOT called (auth rejects first).
 */
// Org-unique so the partial UNIQUE index on organizations.stripe_self_pay_customer_id never
// collides with a leaked test org from a previous run. Set per-test in beforeEach.
let nextNewCustomerId = 'cus_selfpay_new';

vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...actual,
    getStripe: () => {
      throw new Error('getStripe() called directly in a test');
    },
    // Mirror the real contract: if the org already has a customer id, return it unchanged;
    // otherwise mint the (org-unique) new one.
    // Legacy helper — kept so unrelated tests that still import it don't break.
    getOrCreateStripeCustomer: vi.fn(async (_email: string, _name: string, existing?: string | null) => ({
      id: existing ?? nextNewCustomerId,
      object: 'customer',
    })),
    // Dedicated org self-pay helper — used by create-setup-intent after the Fix 1 patch.
    getOrCreateOrgSelfPayCustomer: vi.fn(
      async (_orgId: string, _email: string, _name: string, existing?: string | null) => ({
        id: existing ?? nextNewCustomerId,
        object: 'customer',
        deleted: false,
      }),
    ),
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
import { getOrCreateOrgSelfPayCustomer, createSetupIntent } from '@/lib/stripe';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addOwnerToOrg,
  type TestOrgFixture,
  type OwnerMemberHandle,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

describe('POST /api/stripe/org/create-setup-intent', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalSelfPay: string | undefined;

  beforeEach(async () => {
    originalSelfPay = process.env.STRIPE_SELF_PAY_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_SELF_PAY_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    // Org-unique customer id (avoids the unique-index collision with leaked rows).
    nextNewCustomerId = `cus_selfpay_${org.organizationId.slice(0, 12)}`;
    vi.mocked(getOrCreateOrgSelfPayCustomer).mockClear();
    vi.mocked(createSetupIntent).mockClear();
  });

  afterEach(async () => {
    process.env.STRIPE_SELF_PAY_ENABLED = originalSelfPay;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 404 when STRIPE_SELF_PAY_ENABLED is false', async () => {
    process.env.STRIPE_SELF_PAY_ENABLED = 'false';
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(404);
    expect(vi.mocked(createSetupIntent)).not.toHaveBeenCalled();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
    expect(vi.mocked(getOrCreateOrgSelfPayCustomer)).not.toHaveBeenCalled();
  });

  it('rejects a cleaner (403) before any Stripe call', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(getOrCreateOrgSelfPayCustomer)).not.toHaveBeenCalled();
  });

  it('rejects a homeowner (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('rejects a manager WITHOUT can_manage_payments (403)', async () => {
    const db = createTestSupabaseClient();
    // Promote the homeowner user to manager but grant no payments permission.
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: false,
    });

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(createSetupIntent)).not.toHaveBeenCalled();
  });

  it('allows a manager WITH can_manage_payments (200)', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: true,
    });

    const { status, body } = await callRoute<{ success: boolean; client_secret: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.client_secret).toBe('seti_test_1_secret_abc');
  });

  it('rejects a non-member / cross-org caller (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(getOrCreateOrgSelfPayCustomer)).not.toHaveBeenCalled();
  });

  it('owner happy path: creates the customer, returns a client secret, and persists stripe_self_pay_customer_id', async () => {
    let owner: OwnerMemberHandle | null = null;
    try {
      owner = await addOwnerToOrg(org.organizationId);
      const { status, body } = await callRoute<{
        success: boolean;
        client_secret: string;
        customer_id: string;
      }>(POST, {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.client_secret).toBe('seti_test_1_secret_abc');
      expect(body.customer_id).toBe(nextNewCustomerId);
      expect(vi.mocked(getOrCreateOrgSelfPayCustomer)).toHaveBeenCalledTimes(1);

      // The new self-pay Customer id is persisted on the org.
      const db = createTestSupabaseClient();
      const { data: orgRow } = await db
        .from('organizations')
        .select('stripe_self_pay_customer_id')
        .eq('id', org.organizationId)
        .single();
      expect((orgRow as { stripe_self_pay_customer_id: string }).stripe_self_pay_customer_id).toBe(nextNewCustomerId);
    } finally {
      await owner?.cleanup();
    }
  });

  it('admin happy path persists the new self-pay customer id on the org', async () => {
    const { status, body } = await callRoute<{ success: boolean; customer_id: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.customer_id).toBe(nextNewCustomerId);

    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_self_pay_customer_id')
      .eq('id', org.organizationId)
      .single();
    expect((orgRow as { stripe_self_pay_customer_id: string }).stripe_self_pay_customer_id).toBe(nextNewCustomerId);
  });

  it('reuses an existing self-pay customer id (does not rotate it)', async () => {
    const existingId = `cus_existing_${org.organizationId.slice(0, 12)}`;
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_self_pay_customer_id: existingId })
      .eq('id', org.organizationId);

    const { status, body } = await callRoute<{ customer_id: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    // getOrCreateStripeCustomer was passed the existing id and returns it unchanged.
    expect(body.customer_id).toBe(existingId);
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_self_pay_customer_id')
      .eq('id', org.organizationId)
      .single();
    expect((orgRow as { stripe_self_pay_customer_id: string }).stripe_self_pay_customer_id).toBe(existingId);
  });
});
