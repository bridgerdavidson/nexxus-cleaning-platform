import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * T1-11 for the self-pay leg: key rotation after a failed create, and the NEW adopt-existing scan
 * (settleSelfPay previously had none — the fixed key was its only lost-response guard, which a
 * rotated key no longer provides).
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveCharge: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
}));

vi.mock('@/lib/stripe/transfers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/transfers')>();
  return {
    ...actual,
    createPlatformTransfer: vi.fn(
      async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
        id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
        amount: p.amountCents,
      }),
    ),
    listTransfersByGroup: vi.fn(async () => []),
    reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
    retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 0, amount_reversed: 0 })),
  };
});

import { settleSelfPay } from '@/lib/payments/settleSelfPay';
import { retrieveCharge } from '@/lib/stripe/reconcile';
import { createPlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

const CLEANER_ACCT = 'acct_selfpay_rot';

describe('settleSelfPay — idempotency-key rotation (T1-11)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: CLEANER_ACCT,
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(createPlatformTransfer).mockImplementation(
      async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
        id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
        amount: p.amountCents,
      }) as unknown as Stripe.Transfer,
    );
    vi.mocked(retrieveCharge).mockReset();
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 0 } as Stripe.Charge);
    vi.mocked(listTransfersByGroup).mockReset();
    vi.mocked(listTransfersByGroup).mockResolvedValue([]);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedSelfPayJob() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
      selfPay: true,
    });
    return { db, apptId: appt.id };
  }

  function cleanerCalls() {
    return vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .filter((c) => c.destinationAccountId === CLEANER_ACCT);
  }

  it('a failed create bumps transfer_attempt and the retry uses a rotated key', async () => {
    const { db, apptId } = await seedSelfPayJob();
    vi.mocked(createPlatformTransfer).mockRejectedValueOnce(
      new Error('balance_insufficient: Insufficient funds in Stripe account'),
    );

    const first = await settleSelfPay(db, apptId, `ch_${apptId}`);
    expect(first).toMatchObject({ settled: false, reason: 'cleaner_transfer_failed' });
    expect(cleanerCalls()[0].idempotencyKey).toBe(`selfpay-cleaner-${apptId}`);

    const { data: failedRow } = await db
      .from('payouts')
      .select('status, transfer_attempt')
      .eq('appointment_id', apptId)
      .single();
    expect(failedRow).toMatchObject({ status: 'failed', transfer_attempt: 1 });

    const second = await settleSelfPay(db, apptId, `ch_${apptId}`);
    expect(second.settled).toBe(true);
    const calls = cleanerCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].idempotencyKey).toBe(`selfpay-cleaner-${apptId}-1`);

    const { data: paidRow } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', apptId)
      .single();
    expect(paidRow).toMatchObject({ status: 'paid' });
  });

  it('a retry adopts an existing group transfer instead of re-creating (lost-response guard)', async () => {
    const { db, apptId } = await seedSelfPayJob();
    // Prior attempt: create landed at Stripe but the response was lost — the catch recorded a
    // failed row (no transfer id) and bumped the attempt.
    const { error } = await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: apptId,
      amount: 60,
      status: 'failed',
      transfer_attempt: 1,
      payout_percent_snapshot: 60,
      is_self_pay: true,
    });
    if (error) throw new Error(`payout seed failed: ${error.message}`);
    // Partially reversed before adoption (a refund clawed $15 back): the adopted amount must be
    // what the cleaner actually NETTED, not the gross Transfer.amount.
    vi.mocked(listTransfersByGroup).mockResolvedValue([
      {
        id: 'tr_selfpay_existing',
        amount: 6000,
        amount_reversed: 1500,
        destination: CLEANER_ACCT,
      } as unknown as Stripe.Transfer,
    ]);

    const res = await settleSelfPay(db, apptId, `ch_${apptId}`);
    expect(res).toMatchObject({ settled: true, reason: 'payout_adopted_existing' });
    expect(cleanerCalls()).toHaveLength(0);

    const { data: payout } = await db
      .from('payouts')
      .select('status, stripe_transfer_id, amount')
      .eq('appointment_id', apptId)
      .single();
    expect(payout).toMatchObject({ status: 'paid', stripe_transfer_id: 'tr_selfpay_existing', amount: 45 });

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', apptId);
    expect((events ?? []).map((e) => e.event_type)).toContain('cleaner_payout_repaired');
  });

  it('fails CLOSED when the group scan is unavailable before a rotated create', async () => {
    const { db, apptId } = await seedSelfPayJob();
    const { error } = await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: apptId,
      amount: 60,
      status: 'failed',
      transfer_attempt: 1,
      payout_percent_snapshot: 60,
      is_self_pay: true,
    });
    if (error) throw new Error(`payout seed failed: ${error.message}`);
    vi.mocked(listTransfersByGroup).mockRejectedValue(new Error('stripe 429'));

    const res = await settleSelfPay(db, apptId, `ch_${apptId}`);
    expect(res).toMatchObject({ settled: false, reason: 'cleaner_adopt_scan_unavailable' });
    expect(cleanerCalls()).toHaveLength(0);

    // Row untouched: still failed at attempt 1 for the next sweep.
    const { data: row } = await db
      .from('payouts')
      .select('status, transfer_attempt')
      .eq('appointment_id', apptId)
      .single();
    expect(row).toMatchObject({ status: 'failed', transfer_attempt: 1 });
  });
});
