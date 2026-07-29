import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * T1-5: a manually recorded cash payment (payment_type='revenue', stripe_payment_intent_id NULL,
 * status='paid') can COEXIST with a Stripe revenue row left `failed` by an earlier decline — the
 * partial unique index (migration 088) only covers Stripe-backed rows. The charge idempotency guard
 * (`alreadySettled`) must scan ALL revenue rows and prefer a paid/processing one; an unordered
 * `.limit(1)` could return the `failed` sibling and charge the card a SECOND time for money already
 * collected in cash.
 */
vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(),
}));
// The T1-16 guard tests drive the FULL homeowner charge path (past the preconditions the T1-5
// tests bail on), which validates the saved card against the customer before creating.
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  paymentMethodBelongsToCustomer: vi.fn(async () => true),
  getPaymentMethodType: vi.fn(async () => 'card'),
  listSavedCards: vi.fn(async () => []),
}));

import { chargeCompletedAppointmentAuto } from '@/lib/payments/chargeCompletedAppointment';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

describe('chargeCompletedAppointmentAuto — alreadySettled prefers a paid revenue row (T1-5)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
    vi.mocked(createDestinationCharge).mockClear();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedCompleted() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 120,
    });
    return { db, apptId: appt.id };
  }

  it('short-circuits to charged (no second card charge) when a manual paid row coexists with a failed Stripe row', async () => {
    const { db, apptId } = await seedCompleted();
    // A prior card decline left a Stripe-backed revenue row `failed` (inside the 088 unique index).
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 120,
      status: 'failed',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_failed_${apptId}`,
    });
    // The operator then recorded the money as cash (no PI, deliberately OUTSIDE the unique index).
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 120,
      status: 'paid',
      payment_method: 'manual',
      payment_type: 'revenue',
      paid_at: new Date().toISOString(),
    });

    const outcome = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');

    // The paid cash row wins over the coexisting failed Stripe row.
    expect(outcome).toMatchObject({ ok: true, code: 'charged' });
    // The money-safety assertion: NO second charge was attempted against the card.
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('short-circuits to processing when only a processing revenue row exists', async () => {
    const { db, apptId } = await seedCompleted();
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 120,
      status: 'processing',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_proc_${apptId}`,
    });

    const outcome = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');
    expect(outcome).toMatchObject({ ok: true, code: 'processing' });
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('negative control: a lone failed row does NOT mask (the charge path runs and bails on no card)', async () => {
    const { db, apptId } = await seedCompleted();
    // Only a failed Stripe row, no paid/processing sibling. The guard must return null so the charge
    // path proceeds; with no payment_method_id on the appointment it bails at `no_card` — proving the
    // failed row was not treated as "already settled".
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 120,
      status: 'failed',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_failed_${apptId}`,
    });

    const outcome = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');
    expect(outcome.code).toBe('no_card');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });
});

// T1-16: a completion attempt whose create threw WITHOUT a PaymentIntent may actually have
// captured at Stripe (lost response). Until the verification sweep resolves it, a fresh charge
// (fresh idempotency key) must be blocked — it could be a SECOND real charge.
describe('chargeCompletedAppointmentAuto — unknown-outcome guard (T1-16)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
    vi.mocked(createDestinationCharge).mockReset();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedChargeable() {
    const db = createTestSupabaseClient();
    // Full charge preconditions: tenant can accept charges, homeowner has a customer + saved card.
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_t116_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_t116_homeowner' })
      .eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 120,
    });
    await db.from('appointments').update({ payment_method_id: 'pm_t116_card' }).eq('id', appt.id);
    return { db, apptId: appt.id };
  }

  async function revenueRow(db: ReturnType<typeof createTestSupabaseClient>, apptId: string) {
    const { data } = await db
      .from('payments')
      .select('status, stripe_payment_intent_id, charge_kind, charge_outcome_verified_at')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue')
      .maybeSingle();
    return data as {
      status: string;
      stripe_payment_intent_id: string | null;
      charge_kind: string | null;
      charge_outcome_verified_at: string | null;
    } | null;
  }

  it('a create that throws with NO PaymentIntent records the unknown shape and blocks the next attempt', async () => {
    const { db, apptId } = await seedChargeable();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(new Error('socket hang up'));

    const first = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');
    expect(first.code).toBe('declined');
    const row = await revenueRow(db, apptId);
    expect(row).toMatchObject({
      status: 'failed',
      stripe_payment_intent_id: null,
      charge_kind: 'completion',
      charge_outcome_verified_at: null,
    });
    const { data: events } = await db
      .from('payment_events')
      .select('payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'charge_failed');
    expect(
      (events ?? []).some((e) => (e.payload as { outcome_unknown?: boolean }).outcome_unknown === true),
    ).toBe(true);

    // Retry before the sweep verified: blocked, no second Stripe create.
    const second = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');
    expect(second.code).toBe('outcome_verification_pending');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
  });

  it('unblocks after the sweep stamps the row verified-absent, and a real decline clears the shape', async () => {
    const { db, apptId } = await seedChargeable();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(new Error('socket hang up'));
    await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');

    // Sweep verdict: Stripe has no charge for this appointment.
    await db
      .from('payments')
      .update({ charge_outcome_verified_at: new Date().toISOString() })
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue');

    // A real decline this time (Stripe attached the PI): the retry runs and the row leaves the
    // unknown shape (PI recorded), so future retries need no verification.
    const declineErr = Object.assign(new Error('card declined'), {
      payment_intent: { id: `pi_declined_${apptId}`, status: 'requires_payment_method' },
    });
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(declineErr);
    const retry = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');
    expect(retry.code).toBe('declined');
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(2);
    const row = await revenueRow(db, apptId);
    expect(row?.stripe_payment_intent_id).toBe(`pi_declined_${apptId}`);
  });

  it('a NEW unknown outcome after a verified one re-arms the block (stamp cleared, PI re-nulled)', async () => {
    const { db, apptId } = await seedChargeable();
    // Prior real decline left a PI on the row.
    const declineErr = Object.assign(new Error('card declined'), {
      payment_intent: { id: `pi_old_${apptId}`, status: 'requires_payment_method' },
    });
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(declineErr);
    await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');

    // Next attempt dies with no PI: the unknown shape must not be masked by the old PI.
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const unknown = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');
    expect(unknown.code).toBe('declined');
    const row = await revenueRow(db, apptId);
    expect(row?.stripe_payment_intent_id).toBeNull();
    expect(row?.charge_outcome_verified_at).toBeNull();

    const blocked = await chargeCompletedAppointmentAuto(db, apptId, 'user:tester');
    expect(blocked.code).toBe('outcome_verification_pending');
  });
});
