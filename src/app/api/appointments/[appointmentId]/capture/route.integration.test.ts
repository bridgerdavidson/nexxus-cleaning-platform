import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/stripe/charges/capture', () => ({
  capturePaymentIntent: vi.fn(async () => ({ id: 'pi_test_cap', status: 'succeeded' })),
}));
vi.mock('@/lib/stripe/charges/chargeAch', () => ({
  createAchCharge: vi.fn(async () => ({ id: 'pi_ach_test', status: 'processing' })),
}));
vi.mock('@/lib/stripe/charges/chargeSelfPayAch', () => ({
  createSelfPayAchCharge: vi.fn(async () => ({ id: 'pi_selfpay_ach', status: 'processing' })),
}));
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getPaymentMethodType: vi.fn(async () => 'us_bank_account'),
  // chargeSelfPayAchAppointment resolves the org's default company method through this.
  listSavedCards: vi.fn(async () => []),
}));

import { POST } from './route';
import { capturePaymentIntent } from '@/lib/stripe/charges/capture';
import { createAchCharge } from '@/lib/stripe/charges/chargeAch';
import { createSelfPayAchCharge } from '@/lib/stripe/charges/chargeSelfPayAch';
import { getPaymentMethodType, listSavedCards } from '@/lib/stripe/customers/homeowner';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

describe('POST /api/appointments/:appointmentId/capture', () => {
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

  async function makeAuthorizedAppt() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'in_progress',
    });
    await db.from('appointments').update({ authorization_status: 'authorized' }).eq('id', appt.id);
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_type: 'revenue',
      payment_method: 'card',
      stripe_payment_intent_id: 'pi_test_cap',
    });
    return appt;
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await makeAuthorizedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('allows the ASSIGNED cleaner to capture (capture-on-completion)', async () => {
    const appt = await makeAuthorizedAppt(); // assigned to org.cleaner
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('rejects a cleaner who is NOT the appointment\'s assigned cleaner', async () => {
    const appt = await makeAuthorizedAppt();
    const db = createTestSupabaseClient();
    // Unassign so the calling cleaner is no longer the assigned one — the guard must 403.
    await db.from('appointments').update({ cleaner_id: null }).eq('id', appt.id);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('409 when there is no authorization to capture', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
  });

  it('captures and marks the payment paid', async () => {
    const appt = await makeAuthorizedAppt();
    const { status, body } = await callRoute<{ success: boolean; payment_intent_id: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.payment_intent_id).toBe('pi_test_cap');

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('status, captured_at')
      .eq('appointment_id', appt.id);
    const pay = payRows![0] as { status: string; captured_at: string | null };
    expect(pay.status).toBe('paid');
    expect(pay.captured_at).not.toBeNull();

    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('captured');
  });

  it('is idempotent when the payment is already paid (no re-capture, stays paid)', async () => {
    const appt = await makeAuthorizedAppt();
    const db = createTestSupabaseClient();
    // Simulate a prior successful capture (e.g. the payment_intent.succeeded webhook won the race).
    await db.from('payments').update({ status: 'paid' }).eq('appointment_id', appt.id);
    // A second capture would throw "not capturable"; assert we never clobber the paid row.
    vi.mocked(capturePaymentIntent).mockRejectedValueOnce(new Error('intent not capturable'));

    const { status, body } = await callRoute<{ success: boolean; alreadyCaptured?: boolean }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const { data: paidRows } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', appt.id);
    expect((paidRows![0] as { status: string }).status).toBe('paid');
  });

  it('on capture failure: 502, payment marked failed, authorization_status=failed', async () => {
    const appt = await makeAuthorizedAppt();
    vi.mocked(capturePaymentIntent).mockRejectedValueOnce(new Error('card_declined'));

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(502);

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', appt.id);
    expect((payRows![0] as { status: string }).status).toBe('failed');

    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('failed');
  });
});

describe('POST /api/appointments/:appointmentId/capture — ACH charge-at-completion', () => {
  let org: TestOrgFixture;
  let origNewFlow: string | undefined;
  let origAch: string | undefined;
  let origPassthrough: string | undefined;

  beforeEach(async () => {
    origNewFlow = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    origAch = process.env.STRIPE_ACH_ENABLED;
    origPassthrough = process.env.STRIPE_FEE_PASSTHROUGH_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_ACH_ENABLED = 'true';
    org = await withTestOrg();
    vi.mocked(getPaymentMethodType).mockResolvedValue('us_bank_account');
    vi.mocked(createAchCharge).mockResolvedValue({ id: 'pi_ach_test', status: 'processing' } as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = origNewFlow;
    process.env.STRIPE_ACH_ENABLED = origAch;
    process.env.STRIPE_FEE_PASSTHROUGH_ENABLED = origPassthrough;
    await org.cleanup();
  });

  async function makeAchReadyAppt() {
    const db = createTestSupabaseClient();
    const acctId = `acct_ach_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_ach_homeowner' })
      .eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'in_progress',
    });
    // Bank PM on the appointment; NO held PaymentIntent (ACH has no hold).
    await db.from('appointments').update({ payment_method_id: 'pm_bank_test' }).eq('id', appt.id);
    return appt;
  }

  it('charges the bank account (no hold) and writes a PROCESSING payment row', async () => {
    process.env.STRIPE_FEE_PASSTHROUGH_ENABLED = 'true';
    const appt = await makeAchReadyAppt();

    const { status, body } = await callRoute<{ success: boolean; status: string; payment_intent_id: string }>(
      handlerFor(appt.id),
      { method: 'POST', headers: bearerHeader(org.admin.accessToken), body: { organization_id: org.organizationId } },
    );
    expect(status).toBe(200);
    expect(body.status).toBe('processing');
    expect(body.payment_intent_id).toBe('pi_ach_test');

    // $100 service, ACH fee 0.8% -> charge ceil(10000/0.992) = 10081, fee 81.
    expect(vi.mocked(createAchCharge)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAchCharge).mock.calls[0][0].chargeCents).toBe(10081);

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('status, payment_method, stripe_payment_intent_id, processing_fee_cents, amount')
      .eq('appointment_id', appt.id);
    expect(payRows).toHaveLength(1);
    const pay = payRows![0] as {
      status: string;
      payment_method: string;
      stripe_payment_intent_id: string;
      processing_fee_cents: number;
      amount: number;
    };
    expect(pay.status).toBe('processing');
    expect(pay.payment_method).toBe('ach');
    expect(pay.stripe_payment_intent_id).toBe('pi_ach_test');
    expect(Number(pay.processing_fee_cents)).toBe(81);
    expect(Number(pay.amount)).toBe(100.81);

    const { data: ev } = await db.from('payment_events').select('event_type').eq('appointment_id', appt.id);
    expect((ev ?? []).some((e) => (e as { event_type: string }).event_type === 'ach_charge_initiated')).toBe(true);
  });

  it('does NOT settle the cleaner at charge time (no payout until the debit settles)', async () => {
    const appt = await makeAchReadyAppt();
    await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    const db = createTestSupabaseClient();
    const { data: payouts } = await db.from('payouts').select('id').eq('appointment_id', appt.id);
    expect(payouts ?? []).toHaveLength(0);
  });

  it('falls through to 409 for a card PM with no hold (not an ACH appointment)', async () => {
    vi.mocked(getPaymentMethodType).mockResolvedValue('card');
    const appt = await makeAchReadyAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(vi.mocked(createAchCharge)).not.toHaveBeenCalled();
  });
});

describe('POST /api/appointments/:appointmentId/capture — ORG self-pay ACH (charge-at-completion)', () => {
  let org: TestOrgFixture;
  let origNewFlow: string | undefined;
  let origAch: string | undefined;
  let origSelfPay: string | undefined;

  beforeEach(async () => {
    origNewFlow = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    origAch = process.env.STRIPE_ACH_ENABLED;
    origSelfPay = process.env.STRIPE_SELF_PAY_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_ACH_ENABLED = 'true';
    process.env.STRIPE_SELF_PAY_ENABLED = 'true';
    // Cleaner is payout-capable so self-pay can compute the cut (charge depends on payout%).
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_selfpay_cleaner',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    vi.mocked(createSelfPayAchCharge).mockResolvedValue({ id: 'pi_selfpay_ach', status: 'processing' } as never);
    // Org's default company method is a verified bank account.
    vi.mocked(listSavedCards).mockResolvedValue([
      { id: 'pm_org_bank', type: 'us_bank_account', isDefault: true, last4: '6789', bankName: 'Test Bank' },
    ] as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = origNewFlow;
    process.env.STRIPE_ACH_ENABLED = origAch;
    process.env.STRIPE_SELF_PAY_ENABLED = origSelfPay;
    await org.cleanup();
  });

  /** A self-pay appointment (org-owned property) with a company self-pay Customer and NO hold. */
  async function makeSelfPayAppt() {
    const db = createTestSupabaseClient();
    // organizations.stripe_self_pay_customer_id is UNIQUE — derive a per-org value so tests don't
    // collide on the shared local DB (a duplicate-key error would silently leave the id null).
    await db
      .from('organizations')
      .update({ stripe_self_pay_customer_id: `cus_selfpay_${org.organizationId}` })
      .eq('id', org.organizationId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'in_progress',
      orgOwnedProperty: true,
      selfPay: true,
    });
    return appt;
  }

  it('debits the company bank (no hold) and writes a PROCESSING self-pay/ach row', async () => {
    const appt = await makeSelfPayAppt();
    const { status, body } = await callRoute<{ success: boolean; status: string; payment_intent_id: string }>(
      handlerFor(appt.id),
      { method: 'POST', headers: bearerHeader(org.admin.accessToken), body: { organization_id: org.organizationId } },
    );
    expect(status).toBe(200);
    expect(body.status).toBe('processing');
    expect(body.payment_intent_id).toBe('pi_selfpay_ach');

    // 60% of $100 = $60 cut; ACH gross-up ceil(6000/0.992)=6049, fee 49.
    expect(vi.mocked(createSelfPayAchCharge)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSelfPayAchCharge).mock.calls[0][0].chargeCents).toBe(6049);

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('status, payment_method, is_self_pay, stripe_payment_intent_id, processing_fee_cents, amount')
      .eq('appointment_id', appt.id);
    expect(payRows).toHaveLength(1);
    const pay = payRows![0] as {
      status: string;
      payment_method: string;
      is_self_pay: boolean;
      stripe_payment_intent_id: string;
      processing_fee_cents: number;
      amount: number;
    };
    expect(pay.status).toBe('processing');
    expect(pay.payment_method).toBe('ach');
    expect(pay.is_self_pay).toBe(true);
    expect(pay.stripe_payment_intent_id).toBe('pi_selfpay_ach');
    expect(Number(pay.processing_fee_cents)).toBe(49);
    expect(Number(pay.amount)).toBe(60.49);

    const { data: ev } = await db.from('payment_events').select('event_type').eq('appointment_id', appt.id);
    expect((ev ?? []).some((e) => (e as { event_type: string }).event_type === 'ach_charge_initiated')).toBe(true);
  });

  it('does NOT pay the cleaner at charge time (payout waits for the debit to settle)', async () => {
    const appt = await makeSelfPayAppt();
    await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    const db = createTestSupabaseClient();
    const { data: payouts } = await db.from('payouts').select('id').eq('appointment_id', appt.id);
    expect(payouts ?? []).toHaveLength(0);
  });

  it('is idempotent: a repeat completion stays processing and never debits twice', async () => {
    const appt = await makeSelfPayAppt();
    const opts = {
      method: 'POST' as const,
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    };
    const first = await callRoute<{ status: string }>(handlerFor(appt.id), opts);
    expect(first.body.status).toBe('processing');
    const second = await callRoute<{ status: string }>(handlerFor(appt.id), opts);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('processing');
    // The processing-row guard short-circuits the second call before any charge.
    expect(vi.mocked(createSelfPayAchCharge)).toHaveBeenCalledTimes(1);

    const db = createTestSupabaseClient();
    const { data: payRows } = await db.from('payments').select('id').eq('appointment_id', appt.id);
    expect(payRows).toHaveLength(1);
  });

  it('409 (no debit) when the company default method is a card, not a bank', async () => {
    vi.mocked(listSavedCards).mockResolvedValue([
      { id: 'pm_org_card', type: 'card', isDefault: true, last4: '4242', brand: 'visa', expMonth: 12, expYear: 2030 },
    ] as never);
    const appt = await makeSelfPayAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(vi.mocked(createSelfPayAchCharge)).not.toHaveBeenCalled();
  });

  it('409 (no debit) when the assigned cleaner is not payout-capable', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: false })
      .eq('id', org.cleaner.userId);
    const appt = await makeSelfPayAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(vi.mocked(createSelfPayAchCharge)).not.toHaveBeenCalled();
  });
});
