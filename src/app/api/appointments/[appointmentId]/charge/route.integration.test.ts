import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Auto-capture charge primitives (their real impls call getStripe(), stubbed to throw by the global
// integration setup). The orchestration + amount math + ledger run for real against the local DB.
vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(async () => ({ id: 'pi_charge_now', status: 'succeeded' })),
}));
vi.mock('@/lib/stripe/charges/chargeSelfPay', () => ({
  createSelfPayCharge: vi.fn(async () => ({ id: 'pi_selfpay_charge_now', status: 'succeeded' })),
}));
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  listSavedCards: vi.fn(async () => [
    { id: 'pm_company_card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true, type: 'card' },
  ]),
  getPaymentMethodType: vi.fn(async () => 'card'),
  // The saved card is treated as still attached, so the default-card substitution never kicks in.
  paymentMethodBelongsToCustomer: vi.fn(async () => true),
}));

import { POST } from './route';
import { chargeCompletedAppointmentAuto } from '@/lib/payments/chargeCompletedAppointment';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { createSelfPayCharge } from '@/lib/stripe/charges/chargeSelfPay';
import { listSavedCards, getPaymentMethodType } from '@/lib/stripe/customers/homeowner';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, createTestAppointment, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

describe('POST /api/appointments/:appointmentId/charge — homeowner card', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
    vi.mocked(createDestinationCharge).mockClear();
    vi.mocked(getPaymentMethodType).mockClear();
    vi.mocked(getPaymentMethodType).mockResolvedValue('card');
    vi.mocked(createDestinationCharge).mockResolvedValue({ id: 'pi_charge_now', status: 'succeeded' } as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function completedApptWithCard(failedAuth = true): Promise<string> {
    const db = createTestSupabaseClient();
    const acctId = `acct_ready_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_test_homeowner' }).eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });
    const update: Record<string, unknown> = { payment_method_id: 'pm_test_card' };
    if (failedAuth) update.authorization_status = 'failed';
    await db.from('appointments').update(update).eq('id', appt.id);
    return appt.id;
  }

  it('charges a completed appointment now: 200, paid payment row, authorization_status=captured', async () => {
    const apptId = await completedApptWithCard();

    const { status, body } = await callRoute<{ success: boolean; code: string; payment_intent_id: string }>(
      handlerFor(apptId),
      { method: 'POST', headers: bearerHeader(org.admin.accessToken), body: { organization_id: org.organizationId } },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.code).toBe('charged');
    expect(body.payment_intent_id).toBe('pi_charge_now');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string }).authorization_status).toBe('captured');

    const { data: payRows } = await db
      .from('payments')
      .select('status, stripe_payment_intent_id, on_behalf_of_account_id, paid_at')
      .eq('appointment_id', apptId);
    expect(payRows).toHaveLength(1);
    const pay = payRows![0] as { status: string; stripe_payment_intent_id: string; on_behalf_of_account_id: string; paid_at: string };
    expect(pay.status).toBe('paid');
    expect(pay.stripe_payment_intent_id).toBe('pi_charge_now');
    expect(pay.paid_at).not.toBeNull();

    const { data: events } = await db.from('payment_events').select('event_type').eq('appointment_id', apptId);
    expect((events ?? []).some((e) => (e as { event_type: string }).event_type === 'charged')).toBe(true);
  });

  it('409 not_chargeable when the appointment is not completed', async () => {
    const db = createTestSupabaseClient();
    const acctId = `acct_ready_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_test_homeowner' }).eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
    });
    await db.from('appointments').update({ payment_method_id: 'pm_test_card' }).eq('id', appt.id);

    const { status, body } = await callRoute<{ code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('not_chargeable');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('is idempotent: a job already paid returns charged without charging again', async () => {
    const apptId = await completedApptWithCard();
    const db = createTestSupabaseClient();
    // Pre-existing paid revenue row (a prior charge / webhook already settled it).
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 100,
      status: 'paid',
      payment_type: 'revenue',
      payment_method: 'card',
      stripe_payment_intent_id: 'pi_already_paid',
    });

    const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.code).toBe('charged');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('the assigned cleaner can charge their own completed job (200, charged)', async () => {
    const apptId = await completedApptWithCard();
    const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.code).toBe('charged');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
  });

  it('rejects a cleaner who is not assigned to the appointment (403)', async () => {
    const apptId = await completedApptWithCard();
    const db = createTestSupabaseClient();
    // Reassign away from org.cleaner so the caller no longer owns it.
    await db.from('appointments').update({ cleaner_id: null }).eq('id', apptId);

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('403 when a manager WITHOUT can_manage_payments charges a NON-self-pay appointment', async () => {
    const apptId = await completedApptWithCard();
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_payments: false });
    try {
      const { status, body } = await callRoute<{ error: string }>(handlerFor(apptId), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(403);
      expect(body.error).toBe('Requires the Manage Payments permission');
      expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
    } finally {
      await mgr.cleanup();
    }
  });

  it('serializes concurrent charges: only one PaymentIntent, the other returns charge_in_progress (409)', async () => {
    // R7 adds a homeowner "Pay now" alongside the operator "Retry charge", so two humans can fire a
    // charge for the same failed+completed job inside the Stripe-latency window. The atomic claim
    // must let exactly one through: one real PaymentIntent, the loser bows out with 409.
    const apptId = await completedApptWithCard();

    const fire = () =>
      callRoute<{ success: boolean; code: string }>(handlerFor(apptId), {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      });
    const [a, b] = await Promise.all([fire(), fire()]);

    // The single most important invariant (hard): never more than one real charge for the
    // appointment. AT MOST one caller reached createDestinationCharge, so there is no double-charge.
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);

    // Best-effort on the HTTP shape: the loser USUALLY 409s (charge_in_progress) but can legitimately
    // return 200 (charged) if it runs just after the winner commits the paid row and short-circuits
    // via alreadySettled. So we only require both to land on a valid terminal status with at least one
    // 200 (a winner). The money-safety invariants are the single-charge assertion above and the
    // single-paid-row assertion below, not the exact status pairing.
    for (const r of [a, b]) expect([200, 409]).toContain(r.status);
    expect([a.status, b.status]).toContain(200);

    const db = createTestSupabaseClient();
    // The winner captured; exactly one paid revenue row exists (no duplicate charge).
    const { data: a2 } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a2 as { authorization_status: string }).authorization_status).toBe('captured');
    const { data: payRows } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue');
    expect(payRows).toHaveLength(1);
    expect((payRows![0] as { status: string }).status).toBe('paid');
  });

  it('precondition bail on a FAILED job leaves authorization_status still failed (not NULL)', async () => {
    // Regression guard for the claim-release finally: a retry of a `failed` appointment that bails on
    // a pre-Stripe precondition (here no_card) must NOT be dropped to NULL, which would silently
    // remove it from operator triage / the setup_intent self-heal / re-arm the sweep.
    const db = createTestSupabaseClient();
    const acctId = `acct_ready_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });
    // Failed recovery row with NO card on the appointment -> chargeHomeownerNow bails no_card before
    // any PaymentIntent / reauth bump.
    await db.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);

    const outcome = await chargeCompletedAppointmentAuto(db, appt.id, 'operator', 'admin');
    expect(outcome.code).toBe('no_card');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', appt.id).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBe('failed');
  });

  it('a processing outcome releases the claim to NULL (re-arms reconciliation, not triage)', async () => {
    // A non-precondition, non-terminal exit (a PaymentIntent WAS created) must release to NULL so the
    // in-flight processing row is the source of truth; restoring `failed` would double-charge on retry.
    const apptId = await completedApptWithCard();
    vi.mocked(createDestinationCharge).mockResolvedValueOnce({ id: 'pi_processing_now', status: 'processing' } as never);

    const db = createTestSupabaseClient();
    const outcome = await chargeCompletedAppointmentAuto(db, apptId, 'operator', 'admin');
    expect(outcome.code).toBe('processing');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);

    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBeNull();

    const { data: payRows } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue');
    expect(payRows).toHaveLength(1);
    expect((payRows![0] as { status: string }).status).toBe('processing');
  });

  it('lets a manager WITH can_manage_payments charge a NON-self-pay appointment', async () => {
    const apptId = await completedApptWithCard();
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_payments: true });
    try {
      const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(apptId), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(200);
      expect(body.code).toBe('charged');
      expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
    } finally {
      await mgr.cleanup();
    }
  });
});

describe('POST /api/appointments/:appointmentId/charge — self-pay card', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_selfpay_cleaner',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    vi.mocked(createSelfPayCharge).mockClear();
    vi.mocked(listSavedCards).mockClear();
    vi.mocked(listSavedCards).mockResolvedValue([
      { id: 'pm_company_card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true, type: 'card' },
    ] as never);
    vi.mocked(createSelfPayCharge).mockResolvedValue({ id: 'pi_selfpay_charge_now', status: 'succeeded' } as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function completedSelfPayAppt(): Promise<string> {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_self_pay_customer_id: `cus_selfpay_${org.organizationId.slice(0, 12)}` })
      .eq('id', org.organizationId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
      orgOwnedProperty: true,
      selfPay: true,
    });
    await db.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
    return appt.id;
  }

  it('charges a completed self-pay appointment now: 200, paid self-pay row', async () => {
    const apptId = await completedSelfPayAppt();

    const { status, body } = await callRoute<{ success: boolean; code: string; payment_intent_id: string }>(
      handlerFor(apptId),
      { method: 'POST', headers: bearerHeader(org.admin.accessToken), body: { organization_id: org.organizationId } },
    );

    expect(status).toBe(200);
    expect(body.code).toBe('charged');
    expect(body.payment_intent_id).toBe('pi_selfpay_charge_now');
    expect(vi.mocked(createSelfPayCharge)).toHaveBeenCalledTimes(1);

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string }).authorization_status).toBe('captured');

    const { data: payRows } = await db
      .from('payments')
      .select('status, is_self_pay, stripe_payment_intent_id')
      .eq('appointment_id', apptId);
    expect(payRows).toHaveLength(1);
    const pay = payRows![0] as { status: string; is_self_pay: boolean; stripe_payment_intent_id: string };
    expect(pay.status).toBe('paid');
    expect(pay.is_self_pay).toBe(true);
    expect(pay.stripe_payment_intent_id).toBe('pi_selfpay_charge_now');
  });

  it('403 when a manager WITHOUT can_manage_payments charges a self-pay appointment', async () => {
    const apptId = await completedSelfPayAppt();
    const db = createTestSupabaseClient();
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

    const { status, body } = await callRoute<{ error: string }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(body.error).toBe('Requires the Manage Payments permission');
    expect(vi.mocked(createSelfPayCharge)).not.toHaveBeenCalled();
  });

  it('refuses a homeowner actor on the self-pay company-card path (defense in depth)', async () => {
    // Self-pay draws on the COMPANY card, never a homeowner's. Even calling the orchestration directly
    // with actorRole=homeowner (a hypothetical future route regression) must not reach a charge.
    const apptId = await completedSelfPayAppt();
    const db = createTestSupabaseClient();

    const outcome = await chargeCompletedAppointmentAuto(db, apptId, 'homeowner-actor', 'homeowner');
    expect(outcome.code).toBe('not_chargeable');
    expect(vi.mocked(createSelfPayCharge)).not.toHaveBeenCalled();

    // not_chargeable is a pre-Stripe precondition, so the claim releases back to the prior `failed`.
    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBe('failed');
  });
});
