import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * POST /api/stripe/org/confirm-setup-intent — finalize saving the org's company card.
 *
 * Verifies the SetupIntent succeeded, attaches the PaymentMethod to the org's self-pay Customer,
 * and persists organizations.stripe_self_pay_customer_id. Owner/admin or manager with
 * can_manage_payments.
 *
 * Per-file mock of @/lib/stripe (REPLACES the global mock for this file): getStripe returns a tiny
 * fake exposing setupIntents.retrieve (driven by a controllable module-level `nextSetupIntent`), and
 * attachPaymentMethodToCustomer is stubbed. Role/flag rejections are asserted to short-circuit
 * before the attach call.
 */
let nextSetupIntent: {
  status: string;
  payment_method: string | null;
  customer: string | null;
} = { status: 'succeeded', payment_method: 'pm_org_card', customer: 'cus_selfpay_org' };
// Org-unique self-pay customer id for the current test (set in beforeEach).
let orgCustomerId = 'cus_selfpay_org';

vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...actual,
    getStripe: () => ({
      setupIntents: {
        retrieve: vi.fn(async () => nextSetupIntent),
      },
    }),
    attachPaymentMethodToCustomer: vi.fn(async (pm: string, customer: string) => ({
      id: pm,
      object: 'payment_method',
      customer,
    })),
  };
});

import { POST } from './route';
import { attachPaymentMethodToCustomer } from '@/lib/stripe';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

describe('POST /api/stripe/org/confirm-setup-intent', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalSelfPay: string | undefined;

  beforeEach(async () => {
    originalSelfPay = process.env.STRIPE_SELF_PAY_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_SELF_PAY_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    // Org-unique customer id so the unique index on stripe_self_pay_customer_id never collides.
    orgCustomerId = `cus_selfpay_${org.organizationId.slice(0, 12)}`;
    nextSetupIntent = { status: 'succeeded', payment_method: 'pm_org_card', customer: orgCustomerId };
    vi.mocked(attachPaymentMethodToCustomer).mockClear();
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
      body: { organization_id: org.organizationId, setup_intent_id: 'seti_1' },
    });
    expect(status).toBe(404);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();
  });

  it('returns 401 with no Authorization header (setup_intent_id present so auth gate is reached)', async () => {
    // NOTE: this route validates setup_intent_id BEFORE auth, so we pass a valid-shaped id to
    // exercise the 401 path (a missing id would 400 first — see the dedicated 400 test below).
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organization_id: org.organizationId, setup_intent_id: 'seti_1' },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (403) before attaching', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, setup_intent_id: 'seti_1' },
    });
    expect(status).toBe(403);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();
  });

  it('rejects a non-member / cross-org caller (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organization_id: org.organizationId, setup_intent_id: 'seti_1' },
    });
    expect(status).toBe(403);
  });

  it('admin happy path: attaches the PM and persists the self-pay customer id', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      customer_id: string;
      payment_method_id: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, setup_intent_id: 'seti_1' },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.customer_id).toBe(orgCustomerId);
    expect(body.payment_method_id).toBe('pm_org_card');
    expect(vi.mocked(attachPaymentMethodToCustomer)).toHaveBeenCalledWith('pm_org_card', orgCustomerId);

    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_self_pay_customer_id')
      .eq('id', org.organizationId)
      .single();
    expect((orgRow as { stripe_self_pay_customer_id: string }).stripe_self_pay_customer_id).toBe(orgCustomerId);
  });

  it('returns 400 when the SetupIntent is not succeeded', async () => {
    nextSetupIntent = { status: 'requires_payment_method', payment_method: null, customer: 'cus_selfpay_org' };
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, setup_intent_id: 'seti_1' },
    });
    expect(status).toBe(400);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();
  });

  it('returns 403 when the SetupIntent belongs to a different customer than the org has stored', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_self_pay_customer_id: orgCustomerId })
      .eq('id', org.organizationId);
    // SetupIntent resolves to a DIFFERENT customer → cross-org attach attempt.
    nextSetupIntent = { status: 'succeeded', payment_method: 'pm_x', customer: `cus_someone_else_${org.organizationId.slice(0, 8)}` };

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, setup_intent_id: 'seti_1' },
    });
    expect(status).toBe(403);
    expect(vi.mocked(attachPaymentMethodToCustomer)).not.toHaveBeenCalled();
  });

  it('returns 400 when setup_intent_id is missing (authorized admin)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(400);
  });
});
