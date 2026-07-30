import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * reconcileBankPaidPayouts (T1-3): bank_paid must not depend on payout.* webhook delivery.
 * The job lists a stuck cleaner's Stripe payouts (window anchored just before the OLDEST stuck
 * row so an old missed payout is always inside it), replays each terminal one OLDEST-FIRST
 * through the normal idempotent dispatcher, and separately rechecks recent bank_paid stamps for
 * bank bounces. Stripe reads are mocked at the lib/stripe/reconcile seam. The sweep is global
 * on the shared local DB, so rows are seeded with a paid_at deep inside the lookback window
 * (oldest-first ordering puts them at the front of the batch) and assertions are scoped to
 * this org's rows.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
  searchPaymentIntentsByAppointment: vi.fn(async () => []),
  listRecentPaymentIntentsForCustomer: vi.fn(async () => []),
  listConnectedAccountPayouts: vi.fn(async () => []),
  retrieveConnectedAccountPayout: vi.fn(async () => {
    throw new Error('retrieveConnectedAccountPayout not stubbed for this test');
  }),
}));

import { reconcileBankPaidPayouts } from '@/lib/payments/reconcile';
import {
  listConnectedAccountPayouts,
  retrieveConnectedAccountPayout,
} from '@/lib/stripe/reconcile';
import { getPayoutTransferIds } from '@/lib/stripe';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const DAYS = 24 * 60 * 60 * 1000;

describe('reconcileBankPaidPayouts (T1-3 bank-paid backstop)', () => {
  let org: TestOrgFixture;
  let acct: string;

  beforeEach(async () => {
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_test_fake',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    // Unique connect account so the handlers' `.single()` account lookup resolves
    // deterministically on the shared local DB.
    acct = `acct_bankpaid_${org.organizationId.slice(0, 8)}`;
    const db = createTestSupabaseClient();
    await db
      .from('cleaner_profiles')
      .update({ stripe_connect_account_id: acct })
      .eq('id', org.cleaner.userId);
    vi.mocked(listConnectedAccountPayouts).mockClear();
    vi.mocked(listConnectedAccountPayouts).mockResolvedValue([]);
    vi.mocked(retrieveConnectedAccountPayout).mockClear();
    // Default: other lanes' recent bank_paid rows on the shared DB resolve as still-paid.
    vi.mocked(retrieveConnectedAccountPayout).mockImplementation(
      async (_acct: string, payoutId: string) =>
        ({ id: payoutId, object: 'payout', status: 'paid' }) as never,
    );
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedPayoutRow(fields: Record<string, unknown> = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { data: row, error } = await db
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appt.id,
        amount: 60,
        status: 'paid',
        stripe_transfer_id: `tr_bp_${appt.id.slice(0, 8)}`,
        // 44 days: inside the 45-day lookback, far past the 3-day min age, and older than any
        // other lane's freshly-seeded rows so oldest-first ordering picks this cleaner up.
        paid_at: new Date(Date.now() - 44 * DAYS).toISOString(),
        ...fields,
      })
      .select('id, stripe_transfer_id')
      .single();
    if (error) throw new Error(`payout seed failed: ${error.message}`);
    return { appt, rowId: (row as { id: string }).id, transferId: (row as { stripe_transfer_id: string }).stripe_transfer_id };
  }

  it('replays payouts OLDEST-first from a window anchored at the oldest stuck row, healing it to bank_paid', async () => {
    const db = createTestSupabaseClient();
    const { rowId, transferId } = await seedPayoutRow();
    const poOld = `po_bpold_${org.organizationId.slice(0, 8)}`;
    const poNew = `po_bpnew_${org.organizationId.slice(0, 8)}`;
    // Stripe returns newest-first. Only the OLDER payout covers the stuck row's transfer; with
    // payoutsPerCleaner=1, only an oldest-first replay can heal the row (a newest-first slice
    // would burn the cap on poNew and never reach poOld - the confirmed review finding).
    vi.mocked(listConnectedAccountPayouts).mockImplementation(async (accountId: string) =>
      accountId === acct
        ? ([
            { id: poNew, object: 'payout', status: 'paid', amount: 7000, arrival_date: Math.floor(Date.now() / 1000) },
            { id: poOld, object: 'payout', status: 'paid', amount: 6000, arrival_date: Math.floor((Date.now() - 42 * DAYS) / 1000) },
          ] as never)
        : [],
    );
    vi.mocked(getPayoutTransferIds).mockImplementation(async (_acct: string, payoutId: string) =>
      payoutId === poOld ? [transferId] : [],
    );
    try {
      const result = await reconcileBankPaidPayouts(db, { payoutsPerCleaner: 1 });
      expect(result.replayed).toBeGreaterThanOrEqual(1);

      const { data: after } = await db
        .from('payouts')
        .select('status, stripe_payout_id')
        .eq('id', rowId)
        .single();
      expect((after as { status: string }).status).toBe('bank_paid');
      expect((after as { stripe_payout_id: string }).stripe_payout_id).toBe(poOld);

      // The list window was anchored near the stuck row's paid_at (44d), not the full lookback.
      const callForAcct = vi
        .mocked(listConnectedAccountPayouts)
        .mock.calls.find((c) => c[0] === acct);
      expect(callForAcct).toBeTruthy();
      const anchor = (callForAcct![1] as { createdAfterEpochSec?: number })?.createdAfterEpochSec;
      expect(anchor).toBeTypeOf('number');
      // max(now-45d, paid_at-2d) -> within [now-46d-slack, now-44d].
      expect(anchor! * 1000).toBeGreaterThan(Date.now() - 47 * DAYS);
      expect(anchor! * 1000).toBeLessThan(Date.now() - 43 * DAYS);
    } finally {
      vi.mocked(getPayoutTransferIds).mockReset();
      vi.mocked(getPayoutTransferIds).mockResolvedValue([]);
    }
  });

  it('bank-bounce recheck: a recent bank_paid stamp whose payout flipped to failed reverts and notifies once', async () => {
    const db = createTestSupabaseClient();
    const poId = `po_bounce_${org.organizationId.slice(0, 8)}`;
    const { rowId } = await seedPayoutRow({
      status: 'bank_paid',
      stripe_payout_id: poId,
      bank_paid_at: new Date(Date.now() - 1 * DAYS).toISOString(),
      paid_at: null,
    });
    vi.mocked(retrieveConnectedAccountPayout).mockImplementation(
      async (_acct: string, payoutId: string) =>
        ({
          id: payoutId,
          object: 'payout',
          status: payoutId === poId ? 'failed' : 'paid',
          amount: 6000,
          arrival_date: Math.floor(Date.now() / 1000),
          failure_code: 'account_closed',
          failure_message: 'The bank account has been closed.',
        }) as never,
    );

    const result = await reconcileBankPaidPayouts(db);
    expect(result.bankPaidRechecked).toBeGreaterThanOrEqual(1);

    const { data: after } = await db
      .from('payouts')
      .select('status, stripe_payout_id, bank_paid_at')
      .eq('id', rowId)
      .single();
    expect((after as { status: string }).status).toBe('paid');
    expect((after as { stripe_payout_id: string | null }).stripe_payout_id).toBeNull();

    const notifQuery = () =>
      db
        .from('notification_events')
        .select('recipient_user_id')
        .eq('organization_id', org.organizationId)
        .eq('event_type', 'cleaner_payout_bank_failed')
        .eq('recipient_user_id', org.cleaner.userId);
    const { data: notifs } = await notifQuery();
    expect((notifs ?? []).length).toBe(1);

    // Second sweep: the row is no longer bank_paid, so the recheck ignores it; nothing new fires.
    await reconcileBankPaidPayouts(db);
    const { data: notifsAfter } = await notifQuery();
    expect((notifsAfter ?? []).length).toBe(1);
  });

  it('does not poll Stripe for rows younger than the min age', async () => {
    const db = createTestSupabaseClient();
    await seedPayoutRow({ paid_at: new Date(Date.now() - 1 * DAYS).toISOString() });
    await reconcileBankPaidPayouts(db);
    // Other lanes' stale rows may legitimately trigger lookups for OTHER accounts on the shared
    // DB; this cleaner's account must not be one of them.
    const calls = vi.mocked(listConnectedAccountPayouts).mock.calls.map((c) => c[0]);
    expect(calls).not.toContain(acct);
  });
});
