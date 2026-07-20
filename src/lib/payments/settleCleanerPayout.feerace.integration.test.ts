import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * T1-4: the webhook can process payment_intent.succeeded BEFORE the charge route commits the revenue
 * payments row (the only carrier of processing_fee_cents). Settling then would read the passthrough
 * fee as 0 and over-transfer the full grossed-up amount, overdrawing the platform. Settlement must
 * DEFER when the webhook passes a captured amount but no row exists yet; settleUnsettledCaptures
 * re-settles once the row lands (with the fee netted out). Also covers T1-9: a tenant-leg failure
 * bails without paying the cleaner and leaves transfer_amount NULL so the sweep recovers it.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveCharge: vi.fn(async () => ({ amount_refunded: 0 }) as Stripe.Charge),
  retrievePaymentIntent: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
}));

vi.mock('@/lib/stripe/transfers', () => ({
  transferGroupFor: (id: string) => `appt_${id}`,
  createPlatformTransfer: vi.fn(
    async (p: { destinationAccountId: string; amountCents: number; appointmentId: string; idempotencyKey: string }) => ({
      id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
      amount: p.amountCents,
    }),
  ),
  listTransfersByGroup: vi.fn(async () => []),
  reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
  retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 0, amount_reversed: 0 })),
}));

import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

describe('settleCleanerPayout — fee-race defer (T1-4) + tenant-leg failure (T1-9)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_feerace',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_tenant_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(createPlatformTransfer).mockImplementation(
      async (p: { amountCents: number; appointmentId: string; destinationAccountId: string }) => ({
        id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
        amount: p.amountCents,
      }) as never,
    );
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedAppt() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    return { db, apptId: appt.id };
  }

  it('DEFERS (no transfers, no split) when the webhook races ahead of the revenue row', async () => {
    const { db, apptId } = await seedAppt();
    // Webhook passes the grossed-up amount_received + its PI; no revenue payments row exists yet.
    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10300, `pi_${apptId}`);

    expect(res).toEqual({ settled: false, reason: 'payment_row_missing' });
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', apptId)
      .eq('event_type', 'settlement_deferred_no_row');
    expect((events ?? []).length).toBe(1);
  });

  it('DEFERS when the newest revenue row still holds a PRIOR attempt PI (stale fee not yet rewritten)', async () => {
    const { db, apptId } = await seedAppt();
    // A prior attempt left the single revenue row 'failed' with a different PI and no fee. The
    // succeeding retry's webhook (pi_new, $103) fires before finishCharge rewrites the row.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 103,
      status: 'failed',
      payment_method: 'card',
      payment_type: 'revenue',
      processing_fee_cents: null,
      stripe_payment_intent_id: `pi_old_${apptId}`,
    });

    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10300, `pi_new_${apptId}`);
    // Must NOT split on the stale row's null fee (that would over-transfer the $3 passthrough fee).
    expect(res).toEqual({ settled: false, reason: 'payment_row_missing' });
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    const { data: events } = await db
      .from('payment_events')
      .select('payload')
      .eq('appointment_id', apptId)
      .eq('event_type', 'settlement_deferred_no_row');
    expect((events ?? []).length).toBe(1);
    expect((events![0] as { payload: { reason: string } }).payload.reason).toBe('revenue_row_stale_pi');
  });

  it('settles the deferred capture with the fee NETTED once the row exists (recovery path)', async () => {
    const { db, apptId } = await seedAppt();
    // The row now exists: $103 grossed-up, $3 passthrough fee.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 103,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      processing_fee_cents: 300,
      stripe_payment_intent_id: `pi_${apptId}`,
      captured_at: new Date().toISOString(),
    });

    // Reconcile/retry path: capturedCents=null (the sweep passes null; the fee comes from the row).
    const res = await settleCleanerPayout(db, apptId, null);
    expect(res.settled).toBe(true);

    // Split base = 10300 - 300 fee = 10000; cleaner 60% = 6000 (NOT 60% of the full 10300 = 6180).
    const cleanerCall = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .find((c) => c.idempotencyKey === `cleaner-payout-${apptId}`);
    expect(cleanerCall?.amountCents).toBe(6000);
  });

  it('T1-9: a tenant-leg failure bails before paying the cleaner and leaves transfer_amount NULL', async () => {
    const { db, apptId } = await seedAppt();
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      processing_fee_cents: null,
      stripe_payment_intent_id: `pi_${apptId}`,
      captured_at: new Date().toISOString(),
    });
    // The tenant remainder transfer throws (e.g. balance_insufficient).
    vi.mocked(createPlatformTransfer).mockImplementation(async (p: { idempotencyKey: string }) => {
      if (p.idempotencyKey === `tenant-payout-${apptId}`) throw new Error('balance_insufficient');
      return { id: 'tr_should_not_happen', amount: 0 } as never;
    });

    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000, `pi_${apptId}`);
    expect(res).toEqual({ settled: false, reason: 'tenant_transfer_failed' });

    // Cleaner is NOT paid before the tenant is made whole.
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `cleaner-payout-${apptId}` }),
    );
    // A forensic event is recorded (T1-8 maps it to a critical alert), and transfer_amount stays
    // NULL so settleUnsettledCaptures re-selects and retries the leg.
    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', apptId)
      .eq('event_type', 'tenant_transfer_failed');
    expect((events ?? []).length).toBe(1);
    const { data: pay } = await db
      .from('payments')
      .select('transfer_amount')
      .eq('appointment_id', apptId)
      .single();
    expect((pay as { transfer_amount: number | null }).transfer_amount).toBeNull();
  });
});
