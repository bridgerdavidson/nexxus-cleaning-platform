import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Money-correctness mediums (audit M2/M3/M5/M6/M8). Sibling of route.integration.test.ts.
 *
 *   1. M2: settling with an assigned cleaner at 0% records a one-time visibility event +
 *      deduped admin notification (the split was conservation-correct, just silent).
 *   2. M3: the payout.paid fallback only attributes a payout whose AMOUNT matches; a
 *      non-matching bank payout marks nothing (the wrong row caused wrong reversions).
 *   3. M5: a 100%-to-cleaner settlement stamps transfer_amount 0 so the unsettled-captures
 *      sweep stops re-matching the job every cycle.
 *   4. M6: charge.dispute.funds_reinstated re-pays a cleaner whose cut was clawed back on the
 *      dispute loss — exactly once, and only when OUR dispute clawback caused the reversal.
 *   5. M8: settleCleanerPayout refuses a self-pay appointment outright.
 */
vi.mock('@/lib/stripe/transfers', () => ({
  transferGroupFor: (id: string) => `appt_${id}`,
  createPlatformTransfer: vi.fn(
    async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
      id: `tr_mc_${p.appointmentId}_${p.destinationAccountId}`,
      amount: p.amountCents,
    }),
  ),
  listTransfersByGroup: vi.fn(async () => []),
  reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
  retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 6000, amount_reversed: 0 })),
}));

vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(async () => {
    throw new Error('not used in this suite');
  }),
  retrievePaymentIntent: vi.fn(async () => {
    throw new Error('not used in this suite');
  }),
  retrieveCharge: vi.fn(async () => ({ amount: 10000, amount_refunded: 0 })),
}));

import { POST } from './route';
import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  buildPaymentIntentSucceededEvent,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { signWebhookPayload } from '../../../../../tests/helpers/stripe';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

async function postEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const sig = signWebhookPayload(payload);
  return callRoute(POST, {
    method: 'POST',
    url: 'http://test.local/api/stripe/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: payload,
  });
}

describe('POST /api/stripe/webhook (money-correctness mediums)', () => {
  let org: TestOrgFixture;
  let tenantAcct: string;
  let cleanerAcct: string;

  beforeEach(async () => {
    // Unique connected-account id per run: the payout.paid handler resolves the cleaner by
    // account id with .single(), so a shared id (stale rows from aborted local runs) breaks it.
    cleanerAcct = `acct_mc_${randomUUID().slice(0, 10)}`;
    org = await withTestOrg({
      stripeConnectAccountId: cleanerAcct,
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    tenantAcct = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: tenantAcct, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedAppt(opts: { selfPay?: boolean } = {}) {
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
      ...(opts.selfPay ? { selfPay: true, orgOwnedProperty: true } : {}),
    });
  }

  async function seedPayment(appointmentId: string, fields: Record<string, unknown> = {}) {
    const db = createTestSupabaseClient();
    const { data, error } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appointmentId,
        amount: 100,
        status: 'pending',
        payment_method: 'card',
        payment_type: 'revenue',
        charge_kind: 'completion',
        stripe_payment_intent_id: `pi_test_${appointmentId}`,
        ...fields,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`payment seed failed: ${error?.message}`);
    return (data as { id: string }).id;
  }

  it('M2: settling with an assigned cleaner at 0% surfaces it exactly once', async () => {
    const db = createTestSupabaseClient();
    await db.from('cleaner_profiles').update({ payout_percent: 0 }).eq('id', org.cleaner.userId);
    const appt = await seedAppt();
    await seedPayment(appt.id);

    const { status } = await postEvent(
      buildPaymentIntentSucceededEvent({ appointmentId: appt.id, amountDollars: 100, onBehalfOf: tenantAcct }),
    );
    expect(status).toBe(200);

    // Tenant got the full $100 (their true remainder at 0%); no payout row was carved.
    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].destinationAccountId).toBe(tenantAcct);
    expect(calls[0].amountCents).toBe(10000);

    const zeroEvents = async () => {
      const { data } = await db
        .from('payment_events')
        .select('id')
        .eq('appointment_id', appt.id)
        .eq('event_type', 'cleaner_settled_zero_percent');
      return (data ?? []).length;
    };
    expect(await zeroEvents()).toBe(1);

    const { data: notifs } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cleaner_settled_zero_percent');
    expect((notifs ?? []).length).toBeGreaterThan(0);

    // Replay (new event id): the prior-event guard keeps it at one.
    const replay = await postEvent(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 100,
        eventId: `evt_zero_replay_${appt.id}`,
        onBehalfOf: tenantAcct,
      }),
    );
    expect(replay.status).toBe(200);
    expect(await zeroEvents()).toBe(1);
  });

  it('M3: the payout.paid fallback never attributes a bank payout whose amount matches nothing', async () => {
    const db = createTestSupabaseClient();
    const apptA = await seedAppt();
    const apptB = await seedAppt();
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: apptA.id,
      amount: 60,
      status: 'paid',
      payout_percent_snapshot: 60,
      created_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: apptB.id,
      amount: 70,
      status: 'paid',
      payout_percent_snapshot: 60,
    });

    // A $130 bank payout (both jobs bundled) matches NEITHER row alone: attribute nothing.
    const eventId = `evt_payout_nomatch_${org.organizationId.slice(0, 8)}`;
    const { status } = await postEvent({
      id: eventId,
      object: 'event',
      type: 'payout.paid',
      account: cleanerAcct,
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: { id: 'po_nomatch_1', object: 'payout', amount: 13000, arrival_date: Math.floor(Date.now() / 1000) },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    });
    expect(status).toBe(200);

    const { data: rows } = await db
      .from('payouts')
      .select('status, stripe_payout_id')
      .in('appointment_id', [apptA.id, apptB.id]);
    for (const r of (rows ?? []) as Array<{ status: string; stripe_payout_id: string | null }>) {
      expect(r.status).toBe('paid');
      expect(r.stripe_payout_id).toBeNull();
    }
    await db.from('webhook_events').delete().eq('id', eventId);
  });

  it('M5: a 100%-to-cleaner settlement stamps transfer_amount 0 (no tenant leg, no re-matching)', async () => {
    const db = createTestSupabaseClient();
    await db.from('cleaner_profiles').update({ payout_percent: 100 }).eq('id', org.cleaner.userId);
    const appt = await seedAppt();
    await seedPayment(appt.id);

    const { status } = await postEvent(
      buildPaymentIntentSucceededEvent({ appointmentId: appt.id, amountDollars: 100, onBehalfOf: tenantAcct }),
    );
    expect(status).toBe(200);

    // One transfer only: the cleaner's 100%. The tenant leg is an explicit 0.
    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].destinationAccountId).toBe(cleanerAcct);
    expect(calls[0].amountCents).toBe(10000);

    const { data: pay } = await db
      .from('payments')
      .select('transfer_amount')
      .eq('appointment_id', appt.id)
      .single();
    expect(Number((pay as { transfer_amount: number }).transfer_amount)).toBe(0);
  });

  it('M6: funds_reinstated re-pays a dispute-clawed-back cleaner exactly once', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt();
    const paymentId = await seedPayment(appt.id, { status: 'paid' });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'reversed',
      stripe_transfer_id: `tr_clawed_${appt.id}`,
      payout_percent_snapshot: 60,
      reversed_at: new Date().toISOString(),
    });
    // The reversal came from OUR dispute-lost clawback.
    await db.from('payment_events').insert({
      payment_id: paymentId,
      appointment_id: appt.id,
      organization_id: org.organizationId,
      event_type: 'dispute_lost_clawback',
      actor: 'webhook',
      amount: 6000,
      payload: {},
    });

    const buildReinstated = (eventId: string) => ({
      id: eventId,
      object: 'event',
      type: 'charge.dispute.funds_reinstated',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `dp_${appt.id}`,
          object: 'dispute',
          amount: 10000,
          charge: `ch_test_${appt.id}`,
          payment_intent: `pi_test_${appt.id}`,
          status: 'won',
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    });

    const { status } = await postEvent(buildReinstated(`evt_reinstate_${appt.id}`));
    expect(status).toBe(200);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0] as { idempotencyKey: string; amountCents: number; destinationAccountId: string });
    expect(calls).toHaveLength(1);
    expect(calls[0].idempotencyKey).toBe(`cleaner-reinstate-${appt.id}-dp_${appt.id}`);
    expect(calls[0].amountCents).toBe(6000);
    expect(calls[0].destinationAccountId).toBe(cleanerAcct);

    const { data: payout } = await db
      .from('payouts')
      .select('status, stripe_transfer_id')
      .eq('appointment_id', appt.id)
      .single();
    expect((payout as { status: string }).status).toBe('paid');
    expect((payout as { stripe_transfer_id: string }).stripe_transfer_id).toBe(`tr_mc_${appt.id}_${cleanerAcct}`);

    const { data: events } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'dispute_funds_reinstated');
    expect((events ?? []).length).toBe(1);

    // Replay (new event id): the payout is no longer 'reversed', so nothing moves again.
    const replay = await postEvent(buildReinstated(`evt_reinstate_replay_${appt.id}`));
    expect(replay.status).toBe(200);
    expect(vi.mocked(createPlatformTransfer)).toHaveBeenCalledTimes(1);
  });

  it('M6 guard: a refund-driven reversal (no dispute_lost_clawback event) is never re-paid', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt();
    await seedPayment(appt.id, { status: 'refunded' });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'reversed',
      stripe_transfer_id: `tr_refund_clawed_${appt.id}`,
      payout_percent_snapshot: 60,
      reversed_at: new Date().toISOString(),
    });

    const { status } = await postEvent({
      id: `evt_reinstate_guard_${appt.id}`,
      object: 'event',
      type: 'charge.dispute.funds_reinstated',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `dp_guard_${appt.id}`,
          object: 'dispute',
          amount: 10000,
          charge: `ch_test_${appt.id}`,
          payment_intent: `pi_test_${appt.id}`,
          status: 'won',
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    });
    expect(status).toBe(200);

    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();
    const { data: payout } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payout as { status: string }).status).toBe('reversed');
  });

  it('M8: settleCleanerPayout refuses a self-pay appointment outright', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt({ selfPay: true });

    const result = await settleCleanerPayout(db, appt.id, null);
    expect(result).toEqual({ settled: false, reason: 'self_pay' });
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();
  });
});
