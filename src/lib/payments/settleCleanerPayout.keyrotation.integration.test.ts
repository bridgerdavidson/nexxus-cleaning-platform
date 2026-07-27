import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * T1-11: transfer idempotency-key rotation. Stripe replays a key's FIRST result (success or a
 * business error like balance_insufficient) for ~24h, so a failed create under a fixed key locked
 * the payout out of every retry until the key aged out. After a failed create the leg's persisted
 * attempt counter bumps and the next retry uses a rotated key; every rotated create is preceded
 * by an adopt-existing scan of the transfer_group so a lost-response transfer that actually
 * landed is adopted instead of double-paid.
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

import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { retrieveCharge, retrievePaymentIntent } from '@/lib/stripe/reconcile';
import { createPlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

describe('settleCleanerPayout — idempotency-key rotation (T1-11)', () => {
  let org: TestOrgFixture;
  let tenantAcct: string;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_rot',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    const db = createTestSupabaseClient();
    tenantAcct = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: tenantAcct, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(createPlatformTransfer).mockImplementation(
      async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
        id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
        amount: p.amountCents,
      }) as unknown as Stripe.Transfer,
    );
    vi.mocked(retrieveCharge).mockReset();
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 0 } as Stripe.Charge);
    // Rotated tenant retries resolve the settling charge from the revenue row's PI so adoption
    // can be scoped to THIS charge (seeds use pi_<apptId> / ch_<apptId>).
    vi.mocked(retrievePaymentIntent).mockReset();
    vi.mocked(retrievePaymentIntent).mockImplementation(
      async (piId: string) =>
        ({ id: piId, latest_charge: piId.replace('pi_', 'ch_') }) as unknown as Stripe.PaymentIntent,
    );
    vi.mocked(listTransfersByGroup).mockReset();
    vi.mocked(listTransfersByGroup).mockResolvedValue([]);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /** $100 job, cleaner 60%. Optionally pre-marks the tenant leg done / a prior tenant attempt. */
  async function seedJob(opts: { withTenantTransfer?: boolean; tenantAttempt?: number } = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { error } = await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_${appt.id}`,
      ...(opts.withTenantTransfer ? { transfer_amount: 3900 } : {}),
      ...(opts.tenantAttempt ? { tenant_transfer_attempt: opts.tenantAttempt } : {}),
    });
    if (error) throw new Error(`payment seed failed: ${error.message}`);
    return { db, apptId: appt.id };
  }

  function callsTo(destination: string) {
    return vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .filter((c) => c.destinationAccountId === destination);
  }

  it('first settlement uses the historical unsuffixed keys on both legs', async () => {
    const { db, apptId } = await seedJob();

    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(res.settled).toBe(true);

    const tenantCalls = callsTo(tenantAcct);
    const cleanerCalls = callsTo('acct_cleaner_rot');
    expect(tenantCalls).toHaveLength(1);
    expect(tenantCalls[0].idempotencyKey).toBe(`tenant-payout-${apptId}`);
    expect(cleanerCalls).toHaveLength(1);
    expect(cleanerCalls[0].idempotencyKey).toBe(`cleaner-payout-${apptId}`);

    const { data: payout } = await db
      .from('payouts')
      .select('status, transfer_attempt')
      .eq('appointment_id', apptId)
      .single();
    expect(payout).toMatchObject({ status: 'paid', transfer_attempt: 0 });
  });

  it('a failed cleaner create bumps transfer_attempt and the retry uses a rotated key', async () => {
    const { db, apptId } = await seedJob({ withTenantTransfer: true });
    vi.mocked(createPlatformTransfer).mockRejectedValueOnce(
      new Error('balance_insufficient: Insufficient funds in Stripe account'),
    );

    const first = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(first).toMatchObject({ settled: false, reason: 'cleaner_transfer_failed' });

    const { data: failedRow } = await db
      .from('payouts')
      .select('status, transfer_attempt, stripe_transfer_id')
      .eq('appointment_id', apptId)
      .single();
    expect(failedRow).toMatchObject({ status: 'failed', transfer_attempt: 1, stripe_transfer_id: null });
    expect(callsTo('acct_cleaner_rot')[0].idempotencyKey).toBe(`cleaner-payout-${apptId}`);

    // Balance topped up: the retry (reconcile path: null charge id) must use a FRESH key, not the
    // spent one Stripe would replay the cached failure against.
    const second = await settleCleanerPayout(db, apptId, null);
    expect(second.settled).toBe(true);
    const cleanerCalls = callsTo('acct_cleaner_rot');
    expect(cleanerCalls).toHaveLength(2);
    expect(cleanerCalls[1].idempotencyKey).toBe(`cleaner-payout-${apptId}-1`);

    const { data: paidRow } = await db
      .from('payouts')
      .select('status, transfer_attempt')
      .eq('appointment_id', apptId)
      .single();
    expect(paidRow).toMatchObject({ status: 'paid', transfer_attempt: 1 });
  });

  it('a failed tenant create bumps tenant_transfer_attempt; the rotated retry adopts an existing group transfer', async () => {
    const { db, apptId } = await seedJob();
    vi.mocked(createPlatformTransfer).mockRejectedValueOnce(
      new Error('balance_insufficient: Insufficient funds in Stripe account'),
    );

    const first = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(first).toMatchObject({ settled: false, reason: 'tenant_transfer_failed' });
    expect(callsTo(tenantAcct)[0].idempotencyKey).toBe(`tenant-payout-${apptId}`);

    const { data: bumped } = await db
      .from('payments')
      .select('tenant_transfer_attempt, transfer_amount')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue')
      .single();
    expect(bumped).toMatchObject({ tenant_transfer_attempt: 1, transfer_amount: null });

    // The failed create actually LANDED at Stripe (lost response): the rotated retry must adopt
    // it from the group (source-matched to the settling charge), never issue a second transfer.
    vi.mocked(listTransfersByGroup).mockResolvedValue([
      {
        id: 'tr_existing_tenant',
        amount: 3900,
        amount_reversed: 0,
        destination: tenantAcct,
        source_transaction: `ch_${apptId}`,
      } as unknown as Stripe.Transfer,
    ]);
    const second = await settleCleanerPayout(db, apptId, null);
    expect(second.settled).toBe(true);
    expect(callsTo(tenantAcct)).toHaveLength(1); // still just the first, failed create

    const { data: repaired } = await db
      .from('payments')
      .select('transfer_amount, transfer_destination_account_id')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue')
      .single();
    expect(repaired).toMatchObject({ transfer_amount: 3900, transfer_destination_account_id: tenantAcct });

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', apptId);
    expect((events ?? []).map((e) => e.event_type)).toContain('tenant_transfer_repaired');

    // Cleaner leg still first-attempt: unsuffixed key.
    const cleanerCalls = callsTo('acct_cleaner_rot');
    expect(cleanerCalls).toHaveLength(1);
    expect(cleanerCalls[0].idempotencyKey).toBe(`cleaner-payout-${apptId}`);
  });

  it('a rotated tenant retry with no existing group transfer re-creates under the suffixed key', async () => {
    const { db, apptId } = await seedJob({ tenantAttempt: 1 });

    const res = await settleCleanerPayout(db, apptId, null);
    expect(res.settled).toBe(true);

    const tenantCalls = callsTo(tenantAcct);
    expect(tenantCalls).toHaveLength(1);
    expect(tenantCalls[0].idempotencyKey).toBe(`tenant-payout-${apptId}-1`);
  });

  it('fails CLOSED when the group scan is unavailable before a rotated tenant create', async () => {
    const { db, apptId } = await seedJob({ tenantAttempt: 1 });
    vi.mocked(listTransfersByGroup).mockRejectedValue(new Error('stripe 429'));

    const res = await settleCleanerPayout(db, apptId, null);
    expect(res).toMatchObject({ settled: false, reason: 'tenant_adopt_scan_unavailable' });
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    // No bump either: the failure was ours (unreadable Stripe), not a spent key.
    const { data: row } = await db
      .from('payments')
      .select('tenant_transfer_attempt, transfer_amount')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue')
      .single();
    expect(row).toMatchObject({ tenant_transfer_attempt: 1, transfer_amount: null });
  });

  it('does not adopt a SIBLING charge\'s tenant transfer (source-scoped), and re-creates instead', async () => {
    const { db, apptId } = await seedJob({ tenantAttempt: 1 });
    // A cancellation fee's tenant transfer lives in the same appointment group but is sourced to
    // a DIFFERENT charge: it must be skipped (not adopted, not treated as ambiguous).
    vi.mocked(listTransfersByGroup).mockResolvedValue([
      {
        id: 'tr_fee_sibling',
        amount: 2500,
        amount_reversed: 0,
        destination: tenantAcct,
        source_transaction: 'ch_some_other_charge',
      } as unknown as Stripe.Transfer,
    ]);

    const res = await settleCleanerPayout(db, apptId, null);
    expect(res.settled).toBe(true);

    const tenantCalls = callsTo(tenantAcct);
    expect(tenantCalls).toHaveLength(1);
    expect(tenantCalls[0].idempotencyKey).toBe(`tenant-payout-${apptId}-1`);
    const { data: row } = await db
      .from('payments')
      .select('transfer_amount')
      .eq('appointment_id', apptId)
      .eq('payment_type', 'revenue')
      .single();
    expect(row).toMatchObject({ transfer_amount: 3900 });
  });

  it('refuses a rotated tenant create when an unattributable (null-source) group transfer exists', async () => {
    const { db, apptId } = await seedJob({ tenantAttempt: 1 });
    // A null-source transfer with a different amount can be OUR stray whose remainder shifted
    // (refund between attempts): creating alongside it risks double-paying the tenant.
    vi.mocked(listTransfersByGroup).mockResolvedValue([
      { id: 'tr_stray', amount: 1234, amount_reversed: 0, destination: tenantAcct } as unknown as Stripe.Transfer,
    ]);

    const res = await settleCleanerPayout(db, apptId, null);
    expect(res).toMatchObject({ settled: false, reason: 'tenant_adopt_ambiguous' });
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();
  });

  it('does NOT rotate the cleaner key on a concurrent in-flight idempotency conflict', async () => {
    const { db, apptId } = await seedJob({ withTenantTransfer: true });
    vi.mocked(createPlatformTransfer).mockRejectedValueOnce(
      Object.assign(new Error('There is currently another in-progress request using this key'), {
        code: 'idempotency_key_in_use',
      }),
    );

    const first = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(first).toMatchObject({ settled: false, reason: 'cleaner_transfer_failed' });

    // The winner's in-flight create will become this key's cached result: attempt must stay 0 so
    // the next retry collides/replays on the SAME key instead of racing a rotated create.
    const { data: failedRow } = await db
      .from('payouts')
      .select('status, transfer_attempt')
      .eq('appointment_id', apptId)
      .single();
    expect(failedRow).toMatchObject({ status: 'failed', transfer_attempt: 0 });

    const second = await settleCleanerPayout(db, apptId, null);
    expect(second.settled).toBe(true);
    const cleanerCalls = callsTo('acct_cleaner_rot');
    expect(cleanerCalls).toHaveLength(2);
    expect(cleanerCalls[1].idempotencyKey).toBe(`cleaner-payout-${apptId}`);
  });
});
