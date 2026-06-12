import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * retryFailedPayouts selection hardening (audit H4): the sweep must never re-transfer a payout
 * row that already carries a stripe_transfer_id (money moved, possibly under a legacy
 * `payout-{id}` idempotency key the current key wouldn't collapse onto), and must skip
 * snapshot-less rows (re-settling those would recompute from the CURRENT percent). Tested
 * directly, like chargeUncollected, because the route's behavior is covered elsewhere.
 * Assertions are scoped to THIS org's rows: the sweep is global and may touch parallel tests'.
 */
vi.mock('@/lib/stripe/transfers', () => ({
  transferGroupFor: (id: string) => `appt_${id}`,
  createPlatformTransfer: vi.fn(
    async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
      id: `tr_retry_${p.appointmentId}_${p.destinationAccountId}`,
      amount: p.amountCents,
    }),
  ),
  listTransfersByGroup: vi.fn(async () => []),
  reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
  retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 6000, amount_reversed: 0 })),
}));

import { retryFailedPayouts } from '@/lib/payments/reconcile';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('retryFailedPayouts (selection hardening)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_retryflt',
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
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedFailedPayout(fields: Record<string, unknown> = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { error } = await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'failed',
      payout_percent_snapshot: 60,
      ...fields,
    });
    if (error) throw new Error(`payout seed failed: ${error.message}`);
    return appt.id;
  }

  it('re-settles a clean failed row, but never one that already moved money or lacks a snapshot', async () => {
    const db = createTestSupabaseClient();
    const cleanId = await seedFailedPayout();
    const movedId = await seedFailedPayout({ stripe_transfer_id: 'tr_legacy_moved' });
    const snapshotlessId = await seedFailedPayout({ payout_percent_snapshot: null });

    await retryFailedPayouts(db);

    // Only the clean row produced a cleaner transfer.
    const keys = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0] as { idempotencyKey: string })
      .map((c) => c.idempotencyKey);
    expect(keys).toContain(`cleaner-payout-${cleanId}`);
    expect(keys).not.toContain(`cleaner-payout-${movedId}`);
    expect(keys).not.toContain(`cleaner-payout-${snapshotlessId}`);

    const statusOf = async (apptId: string) => {
      const { data } = await db.from('payouts').select('status').eq('appointment_id', apptId).single();
      return (data as { status: string }).status;
    };
    expect(await statusOf(cleanId)).toBe('paid');
    // Untouched by the sweep: settle's repair path (driven by webhook/reconcile settlement) owns
    // the moved row; the snapshot-less row stays for manual review.
    expect(await statusOf(movedId)).toBe('failed');
    expect(await statusOf(snapshotlessId)).toBe('failed');
  });
});
