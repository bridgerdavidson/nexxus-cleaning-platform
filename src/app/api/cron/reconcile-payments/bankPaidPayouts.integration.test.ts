import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * reconcileBankPaidPayouts (T1-3): bank_paid must not depend on payout.* webhook delivery.
 * The job lists a stuck cleaner's recent Stripe payouts and replays each terminal one through
 * the normal idempotent dispatcher as a synthetic event, so all matching/dedupe logic is the
 * handlers'. Tested directly (like chargeUncollected); Stripe reads are mocked at the
 * lib/stripe/reconcile seam. The sweep is global on the shared local DB, so rows are seeded
 * with a paid_at deep inside the lookback window (oldest-first ordering puts them at the front
 * of the batch) and assertions are scoped to this org's rows.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
  listConnectedAccountPayouts: vi.fn(async () => []),
}));

import { reconcileBankPaidPayouts } from '@/lib/payments/reconcile';
import { listConnectedAccountPayouts } from '@/lib/stripe/reconcile';
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
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedStuckPaidRow(fields: Record<string, unknown> = {}) {
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

  it('marks an old stuck paid row bank_paid by replaying the covering Stripe payout', async () => {
    const db = createTestSupabaseClient();
    const { rowId, transferId } = await seedStuckPaidRow();
    const payoutId = `po_bp_${org.organizationId.slice(0, 8)}`;
    vi.mocked(listConnectedAccountPayouts).mockImplementation(async (accountId: string) =>
      accountId === acct
        ? ([
            {
              id: payoutId,
              object: 'payout',
              status: 'paid',
              amount: 6000,
              arrival_date: Math.floor(Date.now() / 1000),
            },
          ] as never)
        : [],
    );
    vi.mocked(getPayoutTransferIds).mockResolvedValue([transferId]);
    try {
      const result = await reconcileBankPaidPayouts(db);
      expect(result.replayed).toBeGreaterThanOrEqual(1);

      const { data: after } = await db
        .from('payouts')
        .select('status, stripe_payout_id')
        .eq('id', rowId)
        .single();
      expect((after as { status: string }).status).toBe('bank_paid');
      expect((after as { stripe_payout_id: string }).stripe_payout_id).toBe(payoutId);
    } finally {
      vi.mocked(getPayoutTransferIds).mockResolvedValue([]);
    }
  });

  it('replays a FAILED payout: notifies the cleaner once (deduped) and leaves unstamped rows alone', async () => {
    const db = createTestSupabaseClient();
    const { rowId } = await seedStuckPaidRow();
    const payoutId = `po_bpf_${org.organizationId.slice(0, 8)}`;
    vi.mocked(listConnectedAccountPayouts).mockImplementation(async (accountId: string) =>
      accountId === acct
        ? ([
            {
              id: payoutId,
              object: 'payout',
              status: 'failed',
              amount: 6000,
              arrival_date: Math.floor(Date.now() / 1000),
              failure_code: 'account_closed',
              failure_message: 'The bank account has been closed.',
            },
          ] as never)
        : [],
    );

    await reconcileBankPaidPayouts(db);
    // The stuck row was never stamped with this payout, so nothing reverts and it stays 'paid'.
    const { data: after } = await db.from('payouts').select('status').eq('id', rowId).single();
    expect((after as { status: string }).status).toBe('paid');

    const notifQuery = () =>
      db
        .from('notification_events')
        .select('recipient_user_id, payload')
        .eq('organization_id', org.organizationId)
        .eq('event_type', 'cleaner_payout_bank_failed')
        .eq('recipient_user_id', org.cleaner.userId);
    const { data: notifs } = await notifQuery();
    expect((notifs ?? []).length).toBe(1);

    // A second sweep replays the same failed payout; the payout-id dedupe absorbs it.
    await reconcileBankPaidPayouts(db);
    const { data: notifsAfter } = await notifQuery();
    expect((notifsAfter ?? []).length).toBe(1);
  });

  it('does not poll Stripe for rows younger than the min age', async () => {
    const db = createTestSupabaseClient();
    await seedStuckPaidRow({ paid_at: new Date(Date.now() - 1 * DAYS).toISOString() });
    await reconcileBankPaidPayouts(db);
    // Other lanes' stale rows may legitimately trigger lookups for OTHER accounts on the shared
    // DB; this cleaner's account must not be one of them.
    const calls = vi.mocked(listConnectedAccountPayouts).mock.calls.map((c) => c[0]);
    expect(calls).not.toContain(acct);
  });
});
