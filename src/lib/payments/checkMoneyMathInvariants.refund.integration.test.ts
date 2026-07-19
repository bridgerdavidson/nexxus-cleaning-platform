import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * T1-13 follow-through: once a held cleaner slice is paid its refund-SHRUNK share, its payout row is
 * smaller than the gross split. The money-math invariant must not flag that as drift (a refund is
 * not a platform loss), while still catching a genuine OVERPAY on a refunded job and keeping the
 * strict two-sided check for the common no-refund case. Assertions are scoped to THIS org's rows
 * (the sweep is global). No Stripe: the check reads only the DB.
 */
import { checkMoneyMathInvariants } from '@/lib/payments/reconcile';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

describe('checkMoneyMathInvariants — refund-adjusted payouts (T1-13)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg({ payoutPercent: 60 });
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /** $100 appointment, cleaner 60% (gross split = $60). Seeds a paid payout of `payoutDollars` and,
   *  when asked, a succeeded refund so the appointment reads as refunded. */
  async function seedPaidPayout(opts: { payoutDollars: number; withRefund: boolean }) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { data: pay } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: 'paid',
        payment_method: 'card',
        payment_type: 'revenue',
        stripe_payment_intent_id: `pi_${appt.id}`,
      })
      .select('id')
      .single();
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: opts.payoutDollars,
      status: 'paid',
      payout_percent_snapshot: 60,
      stripe_transfer_id: `tr_${appt.id}`,
    });
    if (opts.withRefund) {
      await db.from('refunds').insert({
        organization_id: org.organizationId,
        payment_id: (pay as { id: string }).id,
        appointment_id: appt.id,
        stripe_refund_id: `re_${appt.id}`,
        amount: 5000,
        initiator_user_id: org.admin.userId,
        status: 'succeeded',
      });
    }
    return appt.id;
  }

  const violationCountFor = async (apptId: string) => {
    const db = createTestSupabaseClient();
    const { data } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', apptId)
      .eq('event_type', 'money_math_violation');
    return (data ?? []).length;
  };

  it('does not flag a refund-shrunk payout (recorded < gross split, refund present)', async () => {
    const apptId = await seedPaidPayout({ payoutDollars: 30, withRefund: true });
    const db = createTestSupabaseClient();
    await checkMoneyMathInvariants(db, { batch: 1000 });
    expect(await violationCountFor(apptId)).toBe(0);
  });

  it('still flags a genuine OVERPAY on a refunded job (recorded > gross split)', async () => {
    const apptId = await seedPaidPayout({ payoutDollars: 90, withRefund: true });
    const db = createTestSupabaseClient();
    await checkMoneyMathInvariants(db, { batch: 1000 });
    expect(await violationCountFor(apptId)).toBe(1);
  });

  it('keeps the strict two-sided check when there is no refund (underpay is flagged)', async () => {
    const apptId = await seedPaidPayout({ payoutDollars: 30, withRefund: false });
    const db = createTestSupabaseClient();
    await checkMoneyMathInvariants(db, { batch: 1000 });
    expect(await violationCountFor(apptId)).toBe(1);
  });
});
