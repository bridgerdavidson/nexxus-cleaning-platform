import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * T1-13: a HELD cleaner slice (carved when the cleaner wasn't onboarded) that is later settled must
 * be paid its snapshot-percent share of the REFUND-SHRUNK base, never the pre-refund snapshot — else
 * the platform pays the cleaner money the homeowner already got back (a silent loss). The refunded
 * amount is read from the live Stripe charge; transfers are stubbed so we can assert the paid cents.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveCharge: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
}));

vi.mock('@/lib/stripe/transfers', () => ({
  transferGroupFor: (id: string) => `appt_${id}`,
  createPlatformTransfer: vi.fn(
    async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
      id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
      amount: p.amountCents,
    }),
  ),
  listTransfersByGroup: vi.fn(async () => []),
  reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
  retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 0, amount_reversed: 0 })),
}));

import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { retrieveCharge } from '@/lib/stripe/reconcile';
import { createPlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

describe('settleCleanerPayout — carved held slice + refund (T1-13)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_carved',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    const db = createTestSupabaseClient();
    // Tenant (org) must be a ready connected account or settlement bails before the cleaner leg.
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_tenant_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(retrieveCharge).mockReset();
    // Default: no existing group transfers, so the adopt-existing check is a no-op unless a test
    // overrides it. mockReset would clear the impl (→ undefined → crash), so restore the default.
    vi.mocked(listTransfersByGroup).mockReset();
    vi.mocked(listTransfersByGroup).mockResolvedValue([]);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /**
   * $100 job, cleaner 60%. The cleaner's $60 was carved and HELD (pending, no transfer) because they
   * weren't onboarded at first settlement; the tenant was already paid their remainder. Seeds the
   * revenue payment (with transfer_amount set → tenant leg is a no-op) and the held payout.
   */
  async function seedHeldSlice(opts: { payoutStatus?: string; snapshotCents?: number } = {}) {
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
        transfer_amount: 40, // tenant remainder already transferred at first settlement
      })
      .select('id')
      .single();
    const { error } = await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: (opts.snapshotCents ?? 6000) / 100,
      status: opts.payoutStatus ?? 'pending',
      payout_percent_snapshot: 60,
    });
    if (error) throw new Error(`payout seed failed: ${error.message}`);
    return { db, apptId: appt.id, paymentId: (pay as { id: string }).id };
  }

  it('pays the refund-shrunk share, not the snapshot, when a refund landed after the carve', async () => {
    const { db, apptId } = await seedHeldSlice();
    // $50 of the $100 was refunded after the slice was carved.
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 5000 } as Stripe.Charge);

    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(res.settled).toBe(true);

    // Split base = 10000 - 0 fee - 5000 refunded = 5000; cleaner 60% = 3000. NOT the $60 snapshot.
    const cleanerCalls = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .filter((c) => c.idempotencyKey === `cleaner-payout-${apptId}`);
    expect(cleanerCalls).toHaveLength(1);
    expect(cleanerCalls[0].amountCents).toBe(3000);

    const { data: payout } = await db
      .from('payouts')
      .select('status, amount')
      .eq('appointment_id', apptId)
      .single();
    expect((payout as { status: string }).status).toBe('paid');
    expect(Number((payout as { amount: number }).amount)).toBe(30);
  });

  it('pays the full snapshot when no refund has happened (control)', async () => {
    const { db, apptId } = await seedHeldSlice();
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 0 } as Stripe.Charge);

    await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);

    const cleanerCalls = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .filter((c) => c.idempotencyKey === `cleaner-payout-${apptId}`);
    expect(cleanerCalls).toHaveLength(1);
    expect(cleanerCalls[0].amountCents).toBe(6000);
  });

  it('retires the held slice as reversed (no transfer) when a refund fully absorbs it', async () => {
    const { db, apptId } = await seedHeldSlice();
    // Refund shrinks the base to 1 cent → 60% floors to 0 → nothing left to pay the cleaner.
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 9999 } as Stripe.Charge);

    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(res.reason).toBe('cleaner_slice_refund_absorbed');

    const cleanerCalls = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .filter((c) => c.idempotencyKey === `cleaner-payout-${apptId}`);
    expect(cleanerCalls).toHaveLength(0);

    const { data: payout } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', apptId)
      .single();
    expect((payout as { status: string }).status).toBe('reversed');

    const { data: events } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', apptId)
      .eq('event_type', 'cleaner_slice_refund_absorbed');
    expect((events ?? []).length).toBe(1);
  });

  it('adopts an existing group transfer instead of re-issuing under the spent key when the amount shrank [idempotency regression]', async () => {
    // A prior attempt created the cleaner transfer at Stripe but LOST the response, so the row is
    // 'failed' with a NULL transfer_id (H4 repair, which needs the id, cannot cover it). A $50 refund
    // then reversed that transfer to a $30 net. Re-issuing $30 under the spent cleaner-payout key
    // would 400-loop or double-pay after 24h; the settle must ADOPT the existing transfer instead.
    const { db, apptId } = await seedHeldSlice({ payoutStatus: 'failed' });
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 5000 } as Stripe.Charge);
    vi.mocked(listTransfersByGroup).mockResolvedValueOnce([
      { id: 'tr_stranded', destination: 'acct_cleaner_carved', amount: 3000, amount_reversed: 0 },
    ] as never);

    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(res.reason).toBe('payout_adopted_existing');

    // Never re-issues a transfer under the spent key.
    const cleanerCreates = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .filter((c) => c.idempotencyKey === `cleaner-payout-${apptId}`);
    expect(cleanerCreates).toHaveLength(0);

    const { data: payout } = await db
      .from('payouts')
      .select('status, amount, stripe_transfer_id')
      .eq('appointment_id', apptId)
      .single();
    expect((payout as { status: string }).status).toBe('paid');
    expect((payout as { stripe_transfer_id: string }).stripe_transfer_id).toBe('tr_stranded');
    expect(Number((payout as { amount: number }).amount)).toBe(30);
  });

  it('nets a partial refund from the local ledger when Stripe is unreadable at retry [fallback]', async () => {
    const { db, apptId, paymentId } = await seedHeldSlice();
    // Stripe read fails → chargeAmountRefundedCents returns null. A $50 partial refund lives only in
    // the local ledger (a partial refund never sets payments.status='refunded').
    vi.mocked(retrieveCharge).mockRejectedValue(new Error('stripe down'));
    await db.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: paymentId,
      appointment_id: apptId,
      stripe_refund_id: `re_${apptId}`,
      amount: 5000,
      initiator_user_id: org.admin.userId,
      status: 'succeeded',
    });

    await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);

    // Ledger nets the $50 → base $50 → cleaner 60% = $30, not the full $60 snapshot.
    const cleanerCalls = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .filter((c) => c.idempotencyKey === `cleaner-payout-${apptId}`);
    expect(cleanerCalls).toHaveLength(1);
    expect(cleanerCalls[0].amountCents).toBe(3000);
  });
});
