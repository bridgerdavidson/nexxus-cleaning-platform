import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Settlement/clawback hardening (audit findings H1-H4). Sibling of route.integration.test.ts;
 * mocks the transfer + Stripe-read modules so every Stripe interaction is observable:
 *
 *   1. payment_intent.succeeded delivered AFTER charge.refunded leaves the row 'refunded' and
 *      never settles (H2: the out-of-order clobber that paid out refunded money).
 *   2. A partial refund that landed before settlement shrinks the split base (H2).
 *   3. refund.updated -> failed reverts the payment to 'paid' and alerts admins, deduped (H3).
 *   4. An ACH return on a payout that already reached the cleaner's BANK is surfaced for ops,
 *      never auto-reversed (H1), and the surface doesn't spam on replay.
 *   5. A clawback whose transfer is already fully reversed at Stripe mirrors 'reversed' instead
 *      of over-asking forever (H1: the permanent cleaner_clawback_failed loop).
 *   6. Settlement REPAIRS (never re-transfers) a retryable payout row that already carries a
 *      stripe_transfer_id (H4: legacy `payout-{id}` keys double-pay on retry).
 */
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
import {
  createPlatformTransfer,
  reversePlatformTransfer,
  retrievePlatformTransfer,
} from '@/lib/stripe/transfers';
import { retrieveCharge } from '@/lib/stripe/reconcile';
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

function buildChargeFailedEvent(args: { appointmentId: string; eventId: string }) {
  return {
    id: args.eventId,
    object: 'event',
    type: 'charge.failed',
    api_version: '2025-12-15.clover',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `ch_test_${args.appointmentId}`,
        object: 'charge',
        payment_intent: `pi_test_${args.appointmentId}`,
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  };
}

function buildRefundUpdatedEvent(args: {
  appointmentId: string;
  refundId: string;
  eventId: string;
  status: string;
  amountCents: number;
}) {
  return {
    id: args.eventId,
    object: 'event',
    type: 'refund.updated',
    api_version: '2025-12-15.clover',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: args.refundId,
        object: 'refund',
        status: args.status,
        amount: args.amountCents,
        payment_intent: `pi_test_${args.appointmentId}`,
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  };
}

describe('POST /api/stripe/webhook (settlement + clawback hardening)', () => {
  let org: TestOrgFixture;
  let tenantAcct: string;

  beforeEach(async () => {
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_hardening',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
      // Pinned: assertions here depend on split amounts; the DB default became 100 in migration 111.
      platformFeeBps: 0,
    });
    tenantAcct = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: tenantAcct, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(reversePlatformTransfer).mockClear();
    vi.mocked(retrievePlatformTransfer)
      .mockReset()
      .mockImplementation(async (id: string) => ({ id, amount: 6000, amount_reversed: 0 }) as never);
    vi.mocked(retrieveCharge)
      .mockReset()
      .mockResolvedValue({ amount: 10000, amount_refunded: 0 } as never);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  async function seedAppt(status: 'completed' | 'cancelled' = 'completed') {
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status,
      totalPrice: 100,
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

  it('H2: payment_intent.succeeded delivered AFTER charge.refunded never clobbers or settles', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt('completed');
    // charge.refunded already arrived (out-of-band Dashboard refund) and marked the row refunded.
    await seedPayment(appt.id, { status: 'refunded' });

    const { status } = await postEvent(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 100,
        onBehalfOf: tenantAcct,
      }),
    );
    expect(status).toBe(200);

    const { data: payRow } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payRow as { status: string }).status).toBe('refunded');

    // No settlement: not a cent moved to the tenant or cleaner.
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'settlement_skipped_refunded');
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('H2: a partial refund that landed before settlement shrinks the split base', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt('completed');
    await seedPayment(appt.id);
    // Stripe says $40 of the $100 charge was already refunded when settlement runs.
    vi.mocked(retrieveCharge).mockResolvedValue({ amount: 10000, amount_refunded: 4000 } as never);

    const { status } = await postEvent(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 100,
        onBehalfOf: tenantAcct,
      }),
    );
    expect(status).toBe(200);

    // Split on the un-refunded $60: cleaner 60% = $36, tenant remainder = $24.
    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.destinationAccountId === tenantAcct)?.amountCents).toBe(2400);
    expect(calls.find((c) => c.destinationAccountId === 'acct_cleaner_hardening')?.amountCents).toBe(3600);

    const { data: payout } = await db
      .from('payouts')
      .select('amount, status')
      .eq('appointment_id', appt.id)
      .single();
    expect(Number((payout as { amount: number }).amount)).toBe(36);
    expect((payout as { status: string }).status).toBe('paid');
  });

  it('H3: refund.updated -> failed reverts the payment to paid and alerts admins exactly once', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt('completed');
    const paymentId = await seedPayment(appt.id, { status: 'refunded' });
    const refundId = `re_fail_${appt.id}`;
    await db.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: paymentId,
      appointment_id: appt.id,
      stripe_refund_id: refundId,
      amount: 10000,
      status: 'pending',
    });

    const { status } = await postEvent(
      buildRefundUpdatedEvent({
        appointmentId: appt.id,
        refundId,
        eventId: `evt_ref_fail_${appt.id}`,
        status: 'failed',
        amountCents: 10000,
      }),
    );
    expect(status).toBe(200);

    const { data: refundRow } = await db
      .from('refunds')
      .select('status')
      .eq('stripe_refund_id', refundId)
      .single();
    expect((refundRow as { status: string }).status).toBe('failed');

    // The only covering refund failed -> the payment is NOT refunded anymore.
    const { data: payRow } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((payRow as { status: string }).status).toBe('paid');

    const { data: notifs } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'refund_failed');
    const firstCount = (notifs ?? []).length;
    expect(firstCount).toBeGreaterThan(0);

    // A reprocessed delivery (new event id, same refund) must not double-notify or flip state.
    const replay = await postEvent(
      buildRefundUpdatedEvent({
        appointmentId: appt.id,
        refundId,
        eventId: `evt_ref_fail_replay_${appt.id}`,
        status: 'failed',
        amountCents: 10000,
      }),
    );
    expect(replay.status).toBe(200);

    const { data: notifsAfter } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'refund_failed');
    expect((notifsAfter ?? []).length).toBe(firstCount);

    const { data: payAfter } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((payAfter as { status: string }).status).toBe('paid');
  });

  it('H1: an ACH return on a bank_paid payout is surfaced for ops, never auto-reversed', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt('completed');
    const paymentId = await seedPayment(appt.id, { status: 'paid' });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'bank_paid',
      stripe_transfer_id: `tr_bank_${appt.id}`,
      payout_percent_snapshot: 60,
    });

    const { status } = await postEvent(
      buildChargeFailedEvent({ appointmentId: appt.id, eventId: `evt_chfail_${appt.id}` }),
    );
    expect(status).toBe(200);

    expect(vi.mocked(reversePlatformTransfer)).not.toHaveBeenCalled();
    const { data: payout } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payout as { status: string }).status).toBe('bank_paid');

    const blockedEvents = async () => {
      const { data } = await db
        .from('payment_events')
        .select('id')
        .eq('appointment_id', appt.id)
        .eq('event_type', 'clawback_blocked_bank_paid');
      return (data ?? []).length;
    };
    expect(await blockedEvents()).toBe(1);

    const { data: notifs } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'clawback_blocked');
    const notifCount = (notifs ?? []).length;
    expect(notifCount).toBeGreaterThan(0);

    // Replay (new event id): no second ledger event, no second notification, still no reversal.
    const replay = await postEvent(
      buildChargeFailedEvent({ appointmentId: appt.id, eventId: `evt_chfail_replay_${appt.id}` }),
    );
    expect(replay.status).toBe(200);
    expect(vi.mocked(reversePlatformTransfer)).not.toHaveBeenCalled();
    expect(await blockedEvents()).toBe(1);
    const { data: notifsAfter } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'clawback_blocked');
    expect((notifsAfter ?? []).length).toBe(notifCount);

    // The payment row itself is untouched by the blocked clawback.
    const { data: payRow } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((payRow as { status: string }).status).toBe('paid');
  });

  it('H1: a clawback whose transfer is already fully reversed at Stripe mirrors reversed instead of looping', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt('completed');
    await seedPayment(appt.id, { status: 'paid' });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'paid',
      stripe_transfer_id: `tr_full_${appt.id}`,
      payout_percent_snapshot: 60,
    });
    // Partial-refund reversals already consumed the whole transfer at Stripe.
    vi.mocked(retrievePlatformTransfer).mockImplementation(
      async (id: string) => ({ id, amount: 6000, amount_reversed: 6000 }) as never,
    );

    const { status } = await postEvent(
      buildChargeFailedEvent({ appointmentId: appt.id, eventId: `evt_chfull_${appt.id}` }),
    );
    expect(status).toBe(200);

    // Nothing left to ask Stripe for: no reversal call, the row just mirrors 'reversed'.
    expect(vi.mocked(reversePlatformTransfer)).not.toHaveBeenCalled();
    const { data: payout } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payout as { status: string }).status).toBe('reversed');
  });

  it('H4: settlement repairs (never re-transfers) a failed payout row that already moved money', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedAppt('completed');
    // Tenant leg already ran (transfer_amount recorded); the cleaner transfer went out under a
    // legacy idempotency key but the row was left 'failed'.
    await seedPayment(appt.id, { transfer_amount: 4000 });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'failed',
      stripe_transfer_id: `tr_legacy_${appt.id}`,
      payout_percent_snapshot: 60,
    });

    const { status } = await postEvent(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 100,
        onBehalfOf: tenantAcct,
      }),
    );
    expect(status).toBe(200);

    // No transfer at all: tenant leg was already recorded, cleaner leg is a repair.
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    const { data: payout } = await db
      .from('payouts')
      .select('status, stripe_transfer_id, amount')
      .eq('appointment_id', appt.id)
      .single();
    const row = payout as { status: string; stripe_transfer_id: string; amount: number };
    expect(row.status).toBe('paid');
    expect(row.stripe_transfer_id).toBe(`tr_legacy_${appt.id}`);
    expect(Number(row.amount)).toBe(60);

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cleaner_payout_repaired');
    expect((events ?? []).length).toBe(1);
  });
});
