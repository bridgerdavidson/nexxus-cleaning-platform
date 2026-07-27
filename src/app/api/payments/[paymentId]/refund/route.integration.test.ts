import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Unique refund id per call — refunds.stripe_refund_id is UNIQUE and the refunds table
// isn't cleaned by org.cleanup() (its FKs are NO ACTION), so a constant id would collide
// with a leftover row from a prior test/run and the route's insert would silently no-op.
vi.mock('@/lib/stripe/charges/refund', () => ({
  createRefund: vi.fn(async () => ({ id: `re_test_${crypto.randomUUID()}` })),
}));

// Refund reverses the job's outbound transfers (tenant + cleaner) via the PLATFORM. transferGroupFor
// is pure; listTransfersByGroup returns the two transfers for the job (cleaner 'tr_x' + tenant
// 'tr_tenant'); reversePlatformTransfer is stubbed so we can assert the proportional clawback.
vi.mock('@/lib/stripe/transfers', () => ({
  transferGroupFor: (id: string) => `appt_${id}`,
  listTransfersByGroup: vi.fn(async () => [
    { id: 'tr_x', amount: 6000, amount_reversed: 0 },
    { id: 'tr_tenant', amount: 4000, amount_reversed: 0 },
  ]),
  reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test_123' })),
}));

import { POST } from './route';
import { createRefund } from '@/lib/stripe/charges/refund';
import { reversePlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (paymentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ paymentId }) });

describe('POST /api/payments/:paymentId/refund', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function seedPaidPayment(opts: { status?: string; payoutStatus?: string } = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });
    const { data: pay } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: opts.status ?? 'paid',
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
      amount: 60,
      status: opts.payoutStatus ?? 'paid',
      stripe_transfer_id: 'tr_x',
      source_balance_account_id: 'acct_tenant',
    });
    return { appt, paymentId: (pay as { id: string }).id };
  }

  it('returns 401 with no Authorization header', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status } = await callRoute(handlerFor(paymentId), {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status } = await callRoute(handlerFor(paymentId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('409 when the payment is not in a paid state', async () => {
    const { paymentId } = await seedPaidPayment({ status: 'pending' });
    const { status } = await callRoute(handlerFor(paymentId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
  });

  it('full refund: refunds homeowner, reverses cleaner transfer, marks payment refunded', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status, body } = await callRoute<{
      success: boolean;
      fully_refunded: boolean;
      amount_cents: number;
      transfer_unwind: { reversed_cents: number; failures: number };
    }>(
      handlerFor(paymentId),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );
    expect(status).toBe(200);
    expect(body.fully_refunded).toBe(true);
    expect(body.amount_cents).toBe(10000);
    expect(body.transfer_unwind).toEqual({ reversed_cents: 10000, failures: 0 });

    // full refund → no explicit amount; both transfers fully reversed
    expect(vi.mocked(createRefund)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createRefund).mock.calls[0][0]).toMatchObject({ amountCents: undefined });
    // Cleaner ($60) and tenant remainder ($40) both clawed back to the platform.
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_x', 6000, expect.any(String));
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_tenant', 4000, expect.any(String));

    const db = createTestSupabaseClient();
    const { data: pay } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((pay as { status: string }).status).toBe('refunded');

    const { data: refunds } = await db.from('refunds').select('amount, status').eq('payment_id', paymentId);
    expect(refunds).toHaveLength(1);
    expect(Number((refunds![0] as { amount: number }).amount)).toBe(10000);
  });

  it('ignores a prior failed/canceled refund when computing the refundable amount', async () => {
    const { appt, paymentId } = await seedPaidPayment();
    const db = createTestSupabaseClient();
    // A prior attempt that returned NO money — must not count against the refundable amount.
    await db.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: paymentId,
      appointment_id: appt.id,
      stripe_refund_id: `re_failed_${appt.id}`,
      amount: 10000,
      initiator_user_id: org.admin.userId,
      status: 'failed',
    });

    const { status, body } = await callRoute<{ fully_refunded: boolean; amount_cents: number }>(
      handlerFor(paymentId),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );
    // Before the fix this returned 400 (the failed $100 row zeroed the refundable amount).
    expect(status).toBe(200);
    expect(body.fully_refunded).toBe(true);
    expect(body.amount_cents).toBe(10000);
  });

  it('surfaces a failed refunds-row insert (200 with ledger_recorded=false, not a silent success)', async () => {
    const { appt, paymentId } = await seedPaidPayment();
    const db = createTestSupabaseClient();
    // Pre-seed a refund row that collides on the unique stripe_refund_id. status='failed' so it
    // does NOT count toward the refundable cap (prior fix), leaving the refund itself valid.
    await db.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: paymentId,
      appointment_id: appt.id,
      stripe_refund_id: 're_collide',
      amount: 10000,
      initiator_user_id: org.admin.userId,
      status: 'failed',
    });
    vi.mocked(createRefund).mockResolvedValueOnce({ id: 're_collide' } as unknown as Awaited<ReturnType<typeof createRefund>>);

    const { status, body } = await callRoute<{ ledger_recorded: boolean; refund_id: string }>(
      handlerFor(paymentId),
      { method: 'POST', headers: bearerHeader(org.admin.accessToken), body: { organization_id: org.organizationId } },
    );
    expect(status).toBe(200); // the Stripe refund happened — a 5xx would invite a double-refund
    expect(body.refund_id).toBe('re_collide');
    expect(body.ledger_recorded).toBe(false);

    // The gap is flagged for reconciliation rather than silently swallowed.
    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'refund_ledger_write_failed');
    expect((events ?? []).length).toBe(1);
  });

  it('T1-12a: a second refund after a NET-split settlement tops up only the delta (no over-claw)', async () => {
    // $100 job, $40 refunded BEFORE settlement: settleCleanerPayout split the transfers from the
    // $60 net base (cleaner 3600, tenant 2400). A later $30 refund (cumulative $70) must reverse
    // each leg down to its share of the $30 target base (cleaner 1800, tenant 1200) — the old
    // proportional-to-gross math demanded 2520/1680, over-clawing money settlement already
    // withheld (the live-path half of audit T1-12; the sweep guards were already in place).
    const db = createTestSupabaseClient();
    const { appt, paymentId } = await seedPaidPayment();
    // Activate the invariant path: the locked snapshots settlement actually writes.
    await db
      .from('payments')
      .update({ application_fee_bps_snapshot: 0, processing_fee_cents: null })
      .eq('id', paymentId);
    await db
      .from('payouts')
      .update({ amount: 36, payout_percent_snapshot: 60 })
      .eq('appointment_id', appt.id);
    // The pre-settlement refund, already on the ledger (cents).
    await db.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: paymentId,
      appointment_id: appt.id,
      stripe_refund_id: `re_prior_${appt.id}`,
      amount: 4000,
      status: 'succeeded',
    });
    // Transfers as settlement actually sized them: from the $60 net base.
    vi.mocked(listTransfersByGroup).mockResolvedValueOnce([
      { id: 'tr_x', amount: 3600, amount_reversed: 0 },
      { id: 'tr_tenant', amount: 2400, amount_reversed: 0 },
    ] as never);
    vi.mocked(reversePlatformTransfer).mockClear();

    const { status, body } = await callRoute<{ fully_refunded: boolean; amount_cents: number }>(
      handlerFor(paymentId),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, amount: 30 },
      },
    );
    expect(status).toBe(200);
    expect(body.fully_refunded).toBe(false);
    expect(body.amount_cents).toBe(3000);

    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_x', 1800, expect.any(String));
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_tenant', 1200, expect.any(String));
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledTimes(2);
  });

  it('partial refund: reverses proportional cleaner amount, payment stays paid', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status, body } = await callRoute<{ fully_refunded: boolean; amount_cents: number }>(
      handlerFor(paymentId),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, amount: 40 },
      },
    );
    expect(status).toBe(200);
    expect(body.fully_refunded).toBe(false);
    expect(body.amount_cents).toBe(4000);

    // $40 refund = 40% of gross → cleaner 6000*0.4=2400, tenant 4000*0.4=1600 clawed back.
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_x', 2400, expect.any(String));
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_tenant', 1600, expect.any(String));

    const db = createTestSupabaseClient();
    const { data: pay } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((pay as { status: string }).status).toBe('paid');
  });

  it('two equal-sized partial refunds use DISTINCT idempotency keys (no reuse of the first refund)', async () => {
    const { paymentId } = await seedPaidPayment();
    const refundTwenty = () =>
      callRoute(handlerFor(paymentId), {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, amount: 20 },
      });
    const r1 = await refundTwenty();
    const r2 = await refundTwenty();
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    expect(vi.mocked(createRefund)).toHaveBeenCalledTimes(2);
    const key1 = vi.mocked(createRefund).mock.calls[0][0].idempotencyKey;
    const key2 = vi.mocked(createRefund).mock.calls[1][0].idempotencyKey;
    // Keyed on the cumulative target ($20 then $40), so the 2nd is a genuine second refund, not a
    // reuse of the first that would over-claw-back transfers.
    expect(key1).toBeTruthy();
    expect(key1).not.toBe(key2);
  });

  it('a failed cleaner reversal during refund records refund_clawback_failed (not cleaner_clawback_failed) and still 200s', async () => {
    const { appt, paymentId } = await seedPaidPayment();
    // The cleaner-leg reversal throws; the refund already succeeded, so the route must still 200 and
    // record a REFUND-scoped failure — not cleaner_clawback_failed, which the full-clawback sweep
    // would over-reverse. The stranded unwind is retried by retryStrandedRefundUnwinds and alerted
    // via paymentEventAlerts (T1-1); the response reports it instead of claiming a clean unwind.
    vi.mocked(reversePlatformTransfer).mockImplementation(async (transferId: string) => {
      if (transferId === 'tr_x') throw new Error('reversal boom');
      return { id: 'trr_ok' } as never;
    });
    const db = createTestSupabaseClient();
    try {
      const { status, body } = await callRoute<{
        transfer_unwind: { reversed_cents: number; failures: number };
      }>(handlerFor(paymentId), {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(200);
      // Tenant leg ($40) reversed; the cleaner leg failed and is reported, not hidden.
      expect(body.transfer_unwind).toEqual({ reversed_cents: 4000, failures: 1 });

      const { data: failed } = await db
        .from('payment_events')
        .select('event_type')
        .eq('appointment_id', appt.id)
        .eq('event_type', 'refund_clawback_failed');
      expect((failed ?? []).length).toBe(1);
      const { data: wrongType } = await db
        .from('payment_events')
        .select('event_type')
        .eq('appointment_id', appt.id)
        .eq('event_type', 'cleaner_clawback_failed');
      expect((wrongType ?? []).length).toBe(0);

      // The stranded unwind raised the org-scoped critical platform alert.
      const { data: alerts } = await db
        .from('platform_alerts')
        .select('severity')
        .eq('alert_type', `payment_refund_clawback_failed:${org.organizationId}`)
        .is('resolved_at', null);
      expect((alerts ?? []).length).toBe(1);
      expect((alerts![0] as { severity: string }).severity).toBe('critical');
    } finally {
      // Restore the default success mock for any later test.
      vi.mocked(reversePlatformTransfer).mockReset();
      vi.mocked(reversePlatformTransfer).mockResolvedValue({ id: 'trr_test_123' } as never);
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_refund_clawback_failed:${org.organizationId}`);
    }
  });

  it('does NOT reverse a bank_paid cleaner transfer on refund (blocks for ops, still reverses tenant) [T1-2]', async () => {
    // The cleaner's cut already reached their bank. A refund must not reverse it (would drive their
    // connected balance negative); it surfaces for ops and still claws back the tenant remainder.
    const { appt, paymentId } = await seedPaidPayment({ payoutStatus: 'bank_paid' });
    const db = createTestSupabaseClient();

    const { status, body } = await callRoute<{
      transfer_unwind: { reversed_cents: number; failures: number };
    }>(handlerFor(paymentId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    // Tenant remainder ($40) reversed; cleaner leg blocked (not a failure).
    expect(body.transfer_unwind).toEqual({ reversed_cents: 4000, failures: 0 });
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_tenant', 4000, expect.any(String));
    expect(vi.mocked(reversePlatformTransfer)).not.toHaveBeenCalledWith('tr_x', expect.anything(), expect.anything());

    const { data: blocked } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'clawback_blocked_bank_paid');
    expect((blocked ?? []).length).toBe(1);
  });

  it('scopes the unwind to the refunded charge, leaving a cancellation fee transfer alone [T1-12]', async () => {
    // Same transfer_group carries the completion charge's legs AND a cancellation fee's tenant
    // transfer. A refund of the completion charge must touch only its own legs.
    const { paymentId } = await seedPaidPayment();
    vi.mocked(listTransfersByGroup).mockResolvedValueOnce([
      { id: 'tr_x', amount: 6000, amount_reversed: 0, source_transaction: 'ch_completion' },
      { id: 'tr_tenant', amount: 4000, amount_reversed: 0, source_transaction: 'ch_completion' },
      { id: 'tr_fee', amount: 2500, amount_reversed: 0, source_transaction: 'ch_fee' },
    ] as never);
    // The Stripe refund reports the charge it hit → scopes the unwind to ch_completion.
    vi.mocked(createRefund).mockResolvedValueOnce({
      id: `re_scope_${crypto.randomUUID()}`,
      charge: 'ch_completion',
    } as never);

    const { status } = await callRoute(handlerFor(paymentId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_x', 6000, expect.any(String));
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_tenant', 4000, expect.any(String));
    // The cancellation fee's transfer (different source charge) is never touched.
    expect(vi.mocked(reversePlatformTransfer)).not.toHaveBeenCalledWith('tr_fee', expect.anything(), expect.anything());
  });
});
