import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * retryFailedPayouts hardening (audit H4): a payout row that already carries a
 * stripe_transfer_id (money moved, possibly under a legacy `payout-{id}` idempotency key the
 * current key wouldn't collapse onto) must be REPAIRED by the sweep (marked paid via settle's
 * repair path), never re-transferred; snapshot-less rows are skipped entirely (re-settling
 * those would recompute from the CURRENT percent). Tested directly, like chargeUncollected,
 * because the route's behavior is covered elsewhere. Assertions are scoped to THIS org's rows:
 * the sweep is global and may touch parallel tests'.
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
  createTestPayRequest,
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

  it('re-settles a clean failed row, repairs a money-moved row, and skips a snapshot-less row', async () => {
    const db = createTestSupabaseClient();
    const cleanId = await seedFailedPayout();
    const movedId = await seedFailedPayout({ stripe_transfer_id: 'tr_legacy_moved' });
    const snapshotlessId = await seedFailedPayout({ payout_percent_snapshot: null });

    await retryFailedPayouts(db);

    // Only the clean row produced a cleaner transfer; the money-moved row must never re-transfer.
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
    // The money-moved row is REPAIRED in place (settle's H4 branch: paid, no new transfer).
    expect(await statusOf(movedId)).toBe('paid');
    const { data: repairEvents } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', movedId)
      .eq('event_type', 'cleaner_payout_repaired');
    expect((repairEvents ?? []).length).toBe(1);
    // The snapshot-less row stays for manual review.
    expect(await statusOf(snapshotlessId)).toBe('failed');
  });

  it('retries a failed REQUEST payout (null percent snapshot, cents basis) at the carved amount', async () => {
    const db = createTestSupabaseClient();
    await db.from('cleaner_profiles').update({ payout_model: 'request' }).eq('id', org.cleaner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const pr = await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'approved',
      jobPriceCents: 10000,
      approvedAmountCents: 7200,
      approvedVia: 'org',
    });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 72,
      status: 'failed',
      payout_percent_snapshot: null,
      payout_model_snapshot: 'request',
      pay_request_id: pr.id,
    });

    await retryFailedPayouts(db);

    const calls = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0] as { idempotencyKey: string; amountCents: number });
    const cleanerCall = calls.find((c) => c.idempotencyKey === `cleaner-payout-${appt.id}`);
    expect(cleanerCall?.amountCents).toBe(7200);

    const { data: payout } = await db
      .from('payouts')
      .select('status, amount, payout_percent_snapshot, payout_model_snapshot')
      .eq('appointment_id', appt.id)
      .single();
    const row = payout as Record<string, unknown>;
    expect(row.status).toBe('paid');
    expect(Number(row.amount)).toBe(72);
    expect(row.payout_percent_snapshot).toBeNull();
    expect(row.payout_model_snapshot).toBe('request');
  });
});
