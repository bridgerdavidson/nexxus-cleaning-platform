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
import { listSavedCards, getPaymentMethodType, paymentMethodBelongsToCustomer } from '@/lib/stripe/customers/homeowner';
import { getDefaultPaymentMethod } from '@/lib/stripe';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, addHomeownerToOrg, createTestAppointment, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient, createAnonClient } from '../../../../../../tests/helpers/supabase';

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

  it('a declined charge notifies org staff AND the homeowner in the bell', async () => {
    const apptId = await completedApptWithCard();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(
      Object.assign(new Error('Your card was declined.'), {
        payment_intent: { id: 'pi_declined_bell', status: 'requires_payment_method' },
      }),
    );

    const { status, body } = await callRoute<{ code: string }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(402);
    expect(body.code).toBe('declined');

    const db = createTestSupabaseClient();
    const { data: rows } = await db
      .from('notification_events')
      .select('recipient_user_id, payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_failed');
    const homeownerRows = (rows ?? []).filter(
      (r) => (r as { recipient_user_id: string }).recipient_user_id === org.homeowner.userId,
    );
    expect(homeownerRows).toHaveLength(1);
    const payload = (homeownerRows[0] as { payload: { audience?: string; reason?: string; error?: string } }).payload;
    expect(payload.audience).toBe('homeowner');
    expect(payload.reason).toBe('declined');
    // The raw Stripe error stays internal; the homeowner payload must not carry it.
    expect(payload.error).toBeUndefined();
    // Staff fan-out unchanged alongside the homeowner row.
    const staffRows = (rows ?? []).filter(
      (r) => (r as { recipient_user_id: string }).recipient_user_id !== org.homeowner.userId,
    );
    expect(staffRows.length).toBeGreaterThan(0);
  });

  it("does NOT bell-notify the homeowner about their OWN failed Pay now (actor exclusion)", async () => {
    const apptId = await completedApptWithCard();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(
      Object.assign(new Error('Your card was declined.'), {
        payment_intent: { id: 'pi_declined_self', status: 'requires_payment_method' },
      }),
    );

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(402);

    const db = createTestSupabaseClient();
    const { data: rows } = await db
      .from('notification_events')
      .select('recipient_user_id')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_failed');
    // They watched the decline inline; no self-notification. Staff still notified.
    expect(
      (rows ?? []).some((r) => (r as { recipient_user_id: string }).recipient_user_id === org.homeowner.userId),
    ).toBe(false);
    expect((rows ?? []).length).toBeGreaterThan(0);
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

  // R7 homeowner "Pay now". The route accepts a homeowner caller ONLY through a fail-closed
  // allowlist: their own completed job whose off-session charge already `failed` OR was never charged
  // (`null`), and NOT self-pay. Every other shape (captured, requires_action, non-completed,
  // someone else's) must 403 before any Stripe call.
  it('lets a homeowner charge their OWN failed completed job (200, charged)', async () => {
    const apptId = await completedApptWithCard();
    const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.code).toBe('charged');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
  });

  it("rejects a homeowner charging someone else's appointment (403, ownership guard)", async () => {
    const apptId = await completedApptWithCard(); // owned by org.homeowner
    const other = await addHomeownerToOrg(org.organizationId);
    try {
      const { status, body } = await callRoute<{ error: string }>(handlerFor(apptId), {
        method: 'POST',
        headers: bearerHeader(other.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(403);
      // Pins the rejection to the homeowner ownership allowlist, not some other 403 (e.g. a role gate).
      expect(body.error).toBe('Insufficient role for this action');
      expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
    } finally {
      await other.cleanup();
    }
  });

  it('lets a homeowner charge their own not-yet-charged (NULL) completed job (200, charged)', async () => {
    // "Update card" resets authorization_status to NULL, so after fixing a dead card the homeowner
    // must still be able to self-collect. Completed + NULL auth + non-self-pay is chargeable.
    const apptId = await completedApptWithCard(false);
    const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.code).toBe('charged');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
  });

  it('rejects a homeowner charging their own already-captured completed job (403)', async () => {
    // authorization_status='captured' means the job is already paid: not `failed` and not `null`, so
    // the widened allowlist must still exclude it (no double-charge on an already-collected job).
    const apptId = await completedApptWithCard(false);
    const db = createTestSupabaseClient();
    await db.from('appointments').update({ authorization_status: 'captured' }).eq('id', apptId);

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('rejects a homeowner charging their own NON-completed (confirmed) job (403)', async () => {
    // The job must be completed to self-collect. A confirmed job with a card + NULL auth still 403s
    // on the status condition before any Stripe call.
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

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('rejects a homeowner charging their own requires_action appointment (403, no 3DS loop)', async () => {
    // An off-session retry can never clear 3DS, so requires_action must NOT be homeowner-retryable
    // (allowing it would loop). Only `failed` is.
    const apptId = await completedApptWithCard(false);
    const db = createTestSupabaseClient();
    await db.from('appointments').update({ authorization_status: 'requires_action' }).eq('id', apptId);

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('rejects a homeowner charging their own self-pay appointment (403)', async () => {
    // Self-pay draws on the COMPANY card, not the homeowner's. Keep homeowner_id set (self-pay on a
    // homeowner-owned property) and make it completed + failed so the ONLY failing allowlist
    // condition is is_self_pay.
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
      selfPay: true,
    });
    await db.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
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

  it('a declined SELF-PAY charge never notifies the comped homeowner', async () => {
    // selfPay WITHOUT orgOwnedProperty keeps homeowner_id: a comped booking. The
    // company card failing is staff's problem, not the homeowner's.
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
      selfPay: true,
    });
    await db.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
    vi.mocked(createSelfPayCharge).mockRejectedValueOnce(
      Object.assign(new Error('Company card declined.'), {
        payment_intent: { id: 'pi_selfpay_declined', status: 'requires_payment_method' },
      }),
    );

    const { status, body } = await callRoute<{ code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(402);
    expect(body.code).toBe('declined');

    const { data: rows } = await db
      .from('notification_events')
      .select('recipient_user_id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'charge_failed');
    expect(
      (rows ?? []).some((r) => (r as { recipient_user_id: string }).recipient_user_id === org.homeowner.userId),
    ).toBe(false);
    // Staff still notified about the company-card failure.
    expect((rows ?? []).length).toBeGreaterThan(0);
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

describe('claim_appointment_for_charge RPC (migration 109)', () => {
  // The atomic claim moved from an inline `.update().or()` into this raw-SQL function because
  // PostgREST intermittently failed to resolve authorization_status inside an OR-filtered mutation
  // (42703) on the shared dev project. These tests pin the function's semantics + grants so a
  // future migration can't silently loosen the money-path serialization.
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function apptWithAuthStatus(authorizationStatus: string | null): Promise<string> {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
    if (authorizationStatus !== null) {
      await db.from('appointments').update({ authorization_status: authorizationStatus }).eq('id', appt.id);
    }
    return appt.id;
  }

  it.each([null, 'failed', 'requires_action'])(
    'claims a chargeable row (authorization_status=%s) and flips it to charging',
    async (initial) => {
      const apptId = await apptWithAuthStatus(initial as string | null);
      const db = createTestSupabaseClient();

      const { data, error } = await db.rpc('claim_appointment_for_charge', { p_appointment_id: apptId });
      expect(error).toBeNull();
      expect(data).toEqual([apptId]);

      const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
      expect((a as { authorization_status: string }).authorization_status).toBe('charging');
    },
  );

  it('returns no rows when the claim is already held (charging)', async () => {
    const apptId = await apptWithAuthStatus('failed');
    const db = createTestSupabaseClient();

    const first = await db.rpc('claim_appointment_for_charge', { p_appointment_id: apptId });
    expect(first.data).toEqual([apptId]);

    // Second claim loses: the row is mid-charge, so the caller must bow out (charge_in_progress).
    const second = await db.rpc('claim_appointment_for_charge', { p_appointment_id: apptId });
    expect(second.error).toBeNull();
    expect(second.data).toEqual([]);
  });

  it.each(['captured', 'authorized'])('returns no rows on a non-chargeable terminal status (%s)', async (terminal) => {
    const apptId = await apptWithAuthStatus(terminal);
    const db = createTestSupabaseClient();

    const { data, error } = await db.rpc('claim_appointment_for_charge', { p_appointment_id: apptId });
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // And the terminal status is untouched: the claim never downgrades a paid/authorized row.
    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string }).authorization_status).toBe(terminal);
  });

  it('is not executable by anon (server-only grant)', async () => {
    const apptId = await apptWithAuthStatus('failed');

    const { error } = await createAnonClient().rpc('claim_appointment_for_charge', { p_appointment_id: apptId });
    expect(error).not.toBeNull();

    // And the row was not claimed.
    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string }).authorization_status).toBe('failed');
  });
});

describe('T1-7: charge-precondition bail visibility', () => {
  // A completed job whose charge bails BEFORE Stripe used to vanish: no status, no notification,
  // no ledger row, and (for the no-card cases) no automated path could ever collect it. These pin
  // the two bail treatments: no_card stamps `failed` (human recovery: triage band, card link,
  // setup_intent self-heal, manual record), while tenant_not_ready / cleaner_not_payable keep
  // authorization_status NULL (the reconcile sweep re-attempts, so collection resumes by itself
  // once the org/cleaner finishes setup) and rely on the deduped admin notification + ledger.
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
    vi.mocked(createDestinationCharge).mockClear();
    vi.mocked(createSelfPayCharge).mockClear();
    vi.mocked(paymentMethodBelongsToCustomer).mockClear();
    vi.mocked(paymentMethodBelongsToCustomer).mockResolvedValue(true as never);
    vi.mocked(getPaymentMethodType).mockResolvedValue('card' as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  const postCharge = (apptId: string) =>
    callRoute<{ code: string }>(handlerFor(apptId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

  async function connectReadyOrgAndCustomer(): Promise<void> {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_ready_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_t17_homeowner' }).eq('id', org.homeowner.userId);
  }

  async function completedAppt(update: Record<string, unknown> = {}): Promise<string> {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });
    if (Object.keys(update).length > 0) {
      await db.from('appointments').update(update).eq('id', appt.id);
    }
    return appt.id;
  }

  it('no_card (no saved payment method) stamps failed, notifies admin + homeowner, and ledgers', async () => {
    await connectReadyOrgAndCustomer();
    const apptId = await completedAppt(); // no payment_method_id at all

    const { status, body } = await postCharge(apptId);
    expect(status).toBe(409);
    expect(body.code).toBe('no_card');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    // The stamp: the job now lands in the operator triage band, the card-link route's
    // failed/requires_action gate, and the setup_intent.succeeded self-heal selection.
    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBe('failed');

    // No revenue row: nothing was attempted at Stripe.
    const { data: payRows } = await db.from('payments').select('id').eq('appointment_id', apptId);
    expect(payRows ?? []).toHaveLength(0);

    // Notifications: an admin fan-out row + a homeowner row, both reason no_card.
    const { data: notifs } = await db
      .from('notification_events')
      .select('recipient_user_id, payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_failed');
    const rows = (notifs ?? []) as Array<{ recipient_user_id: string; payload: Record<string, unknown> }>;
    expect(rows.some((r) => r.payload.audience === 'admin' && r.payload.reason === 'no_card')).toBe(true);
    expect(rows.some((r) => r.recipient_user_id === org.homeowner.userId && r.payload.reason === 'no_card')).toBe(true);

    // Forensic ledger row.
    const { data: events } = await db
      .from('payment_events')
      .select('payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_precondition_failed');
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);
    expect(((events![0] as { payload: Record<string, unknown> }).payload as Record<string, unknown>).code).toBe('no_card');

    // A repeat bail (retry, sweep pass) must not stack bell rows: dedupe key is per appointment.
    const before = rows.length;
    const second = await postCharge(apptId);
    expect(second.status).toBe(409);
    const { data: after } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_failed');
    expect((after ?? []).length).toBe(before);
  });

  it('no_card (saved card gone, no default to substitute) also stamps failed', async () => {
    await connectReadyOrgAndCustomer();
    const apptId = await completedAppt({ payment_method_id: 'pm_detached_card' });
    // The saved card no longer belongs to the customer AND the customer has no default to
    // substitute (the integration setup's fake normally supplies 'pm_test_default').
    vi.mocked(paymentMethodBelongsToCustomer).mockResolvedValueOnce(false as never);
    vi.mocked(getDefaultPaymentMethod).mockResolvedValueOnce(null as never);

    const { status, body } = await postCharge(apptId);
    expect(status).toBe(409);
    expect(body.code).toBe('no_card');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db
      .from('appointments')
      .select('authorization_status, payment_method_id')
      .eq('id', apptId)
      .single();
    const row = a as { authorization_status: string | null; payment_method_id: string | null };
    expect(row.authorization_status).toBe('failed');
    // The dead id is cleared so every surface (payment section, home alert, card-link email)
    // reads this as "no card", not a false "card declined"; forensics keep it in the ledger.
    expect(row.payment_method_id).toBeNull();
    const { data: events } = await db
      .from('payment_events')
      .select('payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_precondition_failed');
    const payloads = (events ?? []).map((e) => (e as { payload: Record<string, unknown> }).payload);
    expect(payloads.some((p) => p.payment_method_id === 'pm_detached_card')).toBe(true);
  });

  it('tenant_not_ready keeps the row armed for the sweep (NULL) and notifies admins once', async () => {
    // Homeowner + card are fine; the ORG's Stripe account is not ready. Deliberately NOT stamped
    // failed: the sweep re-attempts NULL rows, so collection resumes the moment onboarding finishes.
    const db = createTestSupabaseClient();
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_t17_homeowner' }).eq('id', org.homeowner.userId);
    const apptId = await completedAppt({ payment_method_id: 'pm_test_card' });

    const { status, body } = await postCharge(apptId);
    expect(status).toBe(409);
    expect(body.code).toBe('tenant_not_ready');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', apptId).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBeNull();

    const { data: notifs } = await db
      .from('notification_events')
      .select('id, payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'tenant_payments_not_ready');
    expect((notifs ?? []).length).toBeGreaterThanOrEqual(1);

    const { data: events } = await db
      .from('payment_events')
      .select('payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_precondition_failed');
    expect(((events![0] as { payload: Record<string, unknown> }).payload as Record<string, unknown>).code).toBe(
      'tenant_not_ready',
    );

    // Deduped on the repeat bail the sweep will inevitably produce; the forensic ledger is
    // likewise bounded (a repeat of the SAME code appends nothing).
    const before = (notifs ?? []).length;
    await postCharge(apptId);
    const { data: after } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', apptId)
      .eq('event_type', 'tenant_payments_not_ready');
    expect((after ?? []).length).toBe(before);
    const { data: eventsAfter } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_precondition_failed');
    expect((eventsAfter ?? []).length).toBe(1);
  });

  it('cleaner_not_payable (self-pay) keeps NULL for the sweep and notifies admins', async () => {
    // Company card exists, but the default test cleaner has no Connect account, so the self-pay
    // charge bails before touching Stripe. NULL keeps the sweep re-attempting so collection
    // resumes automatically once the cleaner finishes payout setup.
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

    const { status, body } = await postCharge(appt.id);
    expect(status).toBe(409);
    expect(body.code).toBe('cleaner_not_payable');
    expect(vi.mocked(createSelfPayCharge)).not.toHaveBeenCalled();

    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', appt.id).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBeNull();

    const { data: notifs } = await db
      .from('notification_events')
      .select('payload')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cleaner_not_payable');
    expect((notifs ?? []).length).toBeGreaterThanOrEqual(1);

    const { data: events } = await db
      .from('payment_events')
      .select('payload')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'charge_precondition_failed');
    expect(((events![0] as { payload: Record<string, unknown> }).payload as Record<string, unknown>).code).toBe(
      'cleaner_not_payable',
    );
  });
});
