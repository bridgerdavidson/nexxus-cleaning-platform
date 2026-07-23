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
