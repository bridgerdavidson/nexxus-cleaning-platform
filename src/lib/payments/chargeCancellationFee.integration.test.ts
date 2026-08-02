import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(async () => ({ id: 'pi_cancelfee_retry', status: 'succeeded' })),
}));
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getPaymentMethodType: vi.fn(async () => 'card'),
}));

import { chargeCancellationFee } from './chargeCancellationFee';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

describe('chargeCancellationFee retry hardening', () => {
  let org: TestOrgFixture;
  const db = createTestSupabaseClient();

  beforeEach(async () => {
    org = await withTestOrg();
    vi.mocked(createDestinationCharge).mockClear();
    vi.mocked(createDestinationCharge).mockResolvedValue({ id: 'pi_cancelfee_retry', status: 'succeeded' } as never);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /** Cancelled appointment + a FAILED fee row, org Stripe-ready, homeowner has a customer. */
  async function seedFailedFee(reauthCount: number | null = 0) {
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_ready_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_test_homeowner' }).eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'cancelled',
    });
    await db
      .from('appointments')
      .update({ payment_method_id: 'pm_test_card', reauth_count: reauthCount })
      .eq('id', appt.id);
    const { data: pay } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 50,
        status: 'failed',
        payment_type: 'revenue',
        payment_method: 'card',
        charge_kind: 'cancellation_fee',
        payment_intent_status: 'requires_payment_method',
      })
      .select('id')
      .single();
    return { appt, paymentId: (pay as { id: string }).id };
  }

  function feeAppt(appt: { id: string }, reauthCount: number | null) {
    return {
      id: appt.id,
      organization_id: org.organizationId,
      homeowner_id: org.homeowner.userId,
      payment_method_id: 'pm_test_card',
      reauth_count: reauthCount,
    };
  }

  it('retry on a failed row: claims the counter, charges with a bumped attempt, flips the row, returns paymentId', async () => {
    const { appt, paymentId } = await seedFailedFee(0);
    const outcome = await chargeCancellationFee(db, feeAppt(appt, 0), 5000, 'user:test', {
      party: 'homeowner',
      noShow: false,
      insideWindow: true,
    });
    expect(outcome.code).toBe('charged');
    expect(outcome.paymentId).toBe(paymentId);
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createDestinationCharge).mock.calls[0][0].reauthAttempt).toBe(1);

    const { data: p } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((p as { status: string }).status).toBe('paid');
    const { data: a } = await db.from('appointments').select('reauth_count').eq('id', appt.id).single();
    expect((a as { reauth_count: number }).reauth_count).toBe(1);
  });

  it('stale counter (concurrent retry): returns retry_in_progress and never charges', async () => {
    const { appt, paymentId } = await seedFailedFee(0);
    // Another caller already advanced the counter after our caller read it.
    await db.from('appointments').update({ reauth_count: 3 }).eq('id', appt.id);

    const outcome = await chargeCancellationFee(db, feeAppt(appt, 0), 5000, 'user:test', {
      party: 'homeowner',
      noShow: false,
      insideWindow: true,
    });
    expect(outcome.code).toBe('retry_in_progress');
    expect(outcome.feeCapturedCents).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();

    const { data: p } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((p as { status: string }).status).toBe('failed');
  });

  it('NULL counter claim works (column starts null)', async () => {
    const { appt } = await seedFailedFee(null);
    const outcome = await chargeCancellationFee(db, feeAppt(appt, null), 5000, 'user:test', {
      party: 'homeowner',
      noShow: false,
      insideWindow: true,
    });
    expect(outcome.code).toBe('charged');
    expect(vi.mocked(createDestinationCharge).mock.calls[0][0].reauthAttempt).toBe(1);
  });

  it('paid short-circuit returns the existing row id as paymentId', async () => {
    const { appt, paymentId } = await seedFailedFee(0);
    await db
      .from('payments')
      .update({ status: 'paid', stripe_payment_intent_id: 'pi_prior_fee' })
      .eq('id', paymentId);
    const outcome = await chargeCancellationFee(db, feeAppt(appt, 0), 5000, 'user:test', {
      party: 'homeowner',
      noShow: false,
      insideWindow: true,
    });
    expect(outcome.code).toBe('charged');
    expect(outcome.paymentId).toBe(paymentId);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });
});
