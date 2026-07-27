import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

// Stripe reads go through @/lib/stripe/reconcile (which calls getStripe(), stubbed to throw by
// the global setup). Mock it so the sweep runs against the real DB with controlled Stripe data.
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
  searchPaymentIntentsByAppointment: vi.fn(async () => []),
}));

// Failed-payout retry → settleCleanerPayout → @/lib/stripe/transfers (getStripe()). Mock it.
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
}));

import { POST } from './route';
import {
  retrieveStripeEvent,
  retrievePaymentIntent,
  retrieveCharge,
  listRefundsForPaymentIntent,
} from '@/lib/stripe/reconcile';
import {
  createPlatformTransfer,
  listTransfersByGroup,
  reversePlatformTransfer,
} from '@/lib/stripe/transfers';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const CRON_SECRET = 'test-cron-secret';
const cronHeaders = { Authorization: `Bearer ${CRON_SECRET}` };
const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe('POST /api/cron/reconcile-payments', () => {
  let org: TestOrgFixture;
  let originalEnabled: string | undefined;
  let originalSecret: string | undefined;

  beforeEach(async () => {
    originalEnabled = process.env.STRIPE_ENABLED;
    originalSecret = process.env.CRON_SECRET;
    process.env.STRIPE_ENABLED = 'true';
    process.env.CRON_SECRET = CRON_SECRET;

    // A fully payable cleaner so the failed-payout retry path can reach a transfer.
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_recon',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
      // Pinned: assertions here depend on split amounts; the DB default became 100 in migration 111.
      platformFeeBps: 0,
    });

    // Benign default: any unexpected PI looks still-in-flight (non-terminal), so the sweep retrieves
    // it but doesn't repair it.
    vi.mocked(retrievePaymentIntent).mockResolvedValue({ status: 'processing' } as Stripe.PaymentIntent);

    // Fresh per-test Stripe fixtures for the stranded-unwind registry mocks.
    stranded.pis.clear();
    stranded.charges.clear();
    stranded.refunds.clear();
    stranded.transfers.clear();
    stranded.unreadablePis.clear();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalEnabled;
    process.env.CRON_SECRET = originalSecret;
    await org.cleanup();
  });

  async function makeTenantReady() {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: `acct_tenant_${org.organizationId.slice(0, 12)}` })
      .eq('id', org.organizationId);
  }

  it('returns 401 with a wrong/missing CRON secret', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: {},
    });
    expect(status).toBe(401);
  });

  it('returns 404 when Stripe is disabled', async () => {
    process.env.STRIPE_ENABLED = 'false';
    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(404);
  });

  it('dead-letter: re-dispatches a stuck webhook_events row and marks it processed', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
    const piId = `pi_dl_${appt.id}`;
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: piId,
      payment_intent_status: 'processing',
    });

    const eventId = `evt_dl_${appt.id}`;
    await db.from('webhook_events').insert({
      id: eventId,
      type: 'payment_intent.canceled',
      status: 'failed',
      received_at: HOUR_AGO(), // older than the stale window so the sweep picks it up
    });

    // Stripe returns the (now resolvable) event — a PI cancellation for our payment.
    vi.mocked(retrieveStripeEvent).mockResolvedValue({
      id: eventId,
      type: 'payment_intent.canceled',
      data: { object: { id: piId, object: 'payment_intent', status: 'canceled' } },
    } as unknown as Stripe.Event);

    const { status, body } = await callRoute<{ deadLetter: { recovered: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.deadLetter.recovered).toBeGreaterThanOrEqual(1);

    const { data: ev } = await db.from('webhook_events').select('status').eq('id', eventId).single();
    expect((ev as { status: string }).status).toBe('processed');

    const { data: pay } = await db
      .from('payments')
      .select('payment_intent_status')
      .eq('stripe_payment_intent_id', piId)
      .single();
    expect((pay as { payment_intent_status: string }).payment_intent_status).toBe('canceled');

    // Clean up the global (non-org-scoped) webhook_events row.
    await db.from('webhook_events').delete().eq('id', eventId);
  });

  it('stuck-payment: replays a missed succeeded PI and marks the payment paid', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
    const piId = `pi_stuck_${appt.id}`;
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: piId,
      created_at: HOUR_AGO(), // past the SLA window
    });

    // Stripe's truth: the charge actually succeeded — a webhook we never got. `on_behalf_of` marks
    // it a new-flow charge; the tenant is NOT marked ready here, so settle short-circuits (no transfer).
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: piId,
      object: 'payment_intent',
      status: 'succeeded',
      amount_received: 10000,
      latest_charge: `ch_stuck_${appt.id}`,
      on_behalf_of: 'acct_tenant_x',
      metadata: { appointment_id: appt.id },
    } as unknown as Stripe.PaymentIntent);

    const { status, body } = await callRoute<{ stuckPayments: { repaired: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.stuckPayments.repaired).toBeGreaterThanOrEqual(1);

    const { data: pay } = await db
      .from('payments')
      .select('status, payment_intent_status')
      .eq('stripe_payment_intent_id', piId)
      .single();
    expect((pay as { status: string }).status).toBe('paid');

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'drift_repaired');
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('stuck-payment: heals a stuck ACH `processing` payment whose succeeded webhook was lost', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const piId = `pi_ach_stuck_${appt.id}`;
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'processing', // ACH debit clearing; the terminal webhook never arrived
      payment_method: 'ach',
      payment_type: 'revenue',
      stripe_payment_intent_id: piId,
      payment_intent_status: 'processing',
      // Older than the ~6-day ACH stale window so the sweep treats it as genuinely stuck (a normal
      // in-flight ACH younger than that is intentionally left alone).
      created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: piId,
      object: 'payment_intent',
      status: 'succeeded',
      amount_received: 10000,
      latest_charge: `ch_ach_stuck_${appt.id}`,
      on_behalf_of: 'acct_tenant_x',
      metadata: { appointment_id: appt.id },
    } as unknown as Stripe.PaymentIntent);

    const { status, body } = await callRoute<{ stuckPayments: { repaired: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.stuckPayments.repaired).toBeGreaterThanOrEqual(1);

    // Previously this row (status='processing') was never swept, so a lost ACH succeeded webhook
    // left it stuck forever. Now it's replayed and marked paid.
    const { data: pay } = await db
      .from('payments')
      .select('status')
      .eq('stripe_payment_intent_id', piId)
      .single();
    expect((pay as { status: string }).status).toBe('paid');
  });

  it('unsettled-capture: settles a captured charge whose funds never moved off the platform', async () => {
    await makeTenantReady();
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    // Captured (status='paid') but transfer_amount still null + captured a while ago → a lost
    // payment_intent.succeeded or a tenant-leg failure. The sweep should re-run settlement.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_unsettled_${appt.id}`,
      payment_intent_status: 'succeeded',
      captured_at: HOUR_AGO(),
    });

    const { status, body } = await callRoute<{ unsettledCaptures: { settled: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.unsettledCaptures.settled).toBeGreaterThanOrEqual(1);

    // Tenant remainder ($40) + cleaner 60% ($60) both transferred off the platform.
    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.destinationAccountId === 'acct_cleaner_recon')?.amountCents).toBe(6000);

    const { data: pay } = await db
      .from('payments')
      .select('transfer_amount')
      .eq('appointment_id', appt.id)
      .eq('payment_type', 'revenue')
      .single();
    expect(Number((pay as { transfer_amount: number }).transfer_amount)).toBe(4000);

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'drift_repaired');
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('failed-payout: re-runs cleaner settlement for a payout left failed', async () => {
    await makeTenantReady();
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    // Real settle-created rows always carry the percent snapshot; the retry sweep requires it
    // (a snapshot-less row would re-settle from the CURRENT percent, which conservation forbids).
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'failed',
      payout_percent_snapshot: 60,
    });

    const { status, body } = await callRoute<{ failedPayouts: { settled: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.failedPayouts.settled).toBeGreaterThanOrEqual(1);

    // Settles from the platform: tenant remainder ($40) + cleaner 60% ($60). Assert the cleaner leg.
    const cleanerCall = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0])
      .find((c) => c.destinationAccountId === 'acct_cleaner_recon');
    expect(cleanerCall?.amountCents).toBe(6000);

    const { data: payout } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payout as { status: string }).status).toBe('paid');
  });

  it('money-math: flags a paid payout that does not match the locked split', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    // Snapshot says 60% of $100 → expected $60, but $90 was recorded. Drift = $30.
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 90,
      status: 'paid',
      payout_percent_snapshot: 60,
    });

    const { status, body } = await callRoute<{ moneyMath: { violations: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.moneyMath.violations).toBeGreaterThanOrEqual(1);

    const { data: events } = await db
      .from('payment_events')
      .select('event_type, amount')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'money_math_violation');
    expect((events ?? []).length).toBe(1);

    // T1-8: the violation was previously recorded only to the write-only payment_events
    // table. It now also raises a platform-owner alert (org-scoped dedupe key).
    const alertType = `payment_money_math_violation:${org.organizationId}`;
    const { data: alerts } = await db
      .from('platform_alerts')
      .select('severity')
      .eq('alert_type', alertType);
    expect((alerts ?? []).length).toBe(1);
    expect((alerts![0] as { severity: string }).severity).toBe('critical');
    await db.from('platform_alerts').delete().eq('alert_type', alertType);
  });

  it('dead-letter: alerts the platform owner when an event still fails after retry', async () => {
    const db = createTestSupabaseClient();
    const eventId = `evt_stuck_${org.organizationId.slice(0, 8)}_${Date.now()}`;
    await db.from('webhook_events').insert({
      id: eventId,
      type: 'payment_intent.succeeded',
      status: 'failed',
      received_at: HOUR_AGO(), // older than the stale window → picked up by the sweep
    });
    // Stripe is unreachable, so the dead-letter retry can't recover it → stillFailed++.
    vi.mocked(retrieveStripeEvent).mockRejectedValue(new Error('stripe unreachable'));

    const { status, body } = await callRoute<{ deadLetter: { stillFailed: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.deadLetter.stillFailed).toBeGreaterThanOrEqual(1);

    // The sweep inspects its own result (pg_cron discards the JSON) and alerts.
    const { data: alerts } = await db
      .from('platform_alerts')
      .select('severity')
      .eq('alert_type', 'reconcile_dead_letter_stuck')
      .is('resolved_at', null);
    expect((alerts ?? []).length).toBeGreaterThanOrEqual(1);
    expect((alerts![0] as { severity: string }).severity).toBe('warning');

    await db.from('webhook_events').delete().eq('id', eventId);
    await db.from('platform_alerts').delete().eq('alert_type', 'reconcile_dead_letter_stuck');
  });

  /**
   * Per-id Stripe fixtures for the stranded-unwind tests. The sweep can see other candidates in
   * the shared DB (parallel sessions), so every mock resolves BY ID from this registry — unknown
   * ids get benign defaults and never interfere.
   */
  const stranded = {
    pis: new Map<string, unknown>(),
    charges: new Map<string, unknown>(),
    refunds: new Map<string, unknown[]>(),
    transfers: new Map<string, unknown[]>(),
    unreadablePis: new Set<string>(),
  };

  function installStrandedMocks() {
    vi.mocked(retrievePaymentIntent).mockImplementation(async (piId: string) => {
      if (stranded.unreadablePis.has(piId)) throw new Error('stripe unreadable');
      return (stranded.pis.get(piId) ?? { status: 'processing' }) as Stripe.PaymentIntent;
    });
    vi.mocked(retrieveCharge).mockImplementation(
      async (chargeId: string) => stranded.charges.get(chargeId) as Stripe.Charge,
    );
    vi.mocked(listRefundsForPaymentIntent).mockImplementation(
      async (piId: string) => (stranded.refunds.get(piId) ?? []) as Stripe.Refund[],
    );
    vi.mocked(listTransfersByGroup).mockImplementation(
      async (group: string) =>
        (stranded.transfers.get(group) ?? []) as Awaited<ReturnType<typeof listTransfersByGroup>>,
    );
  }

  /**
   * Seed the T1-1 stranded state: a refunded payment whose transfer unwind failed (the failure
   * event is on the ledger, the transfers still carry un-reversed money at Stripe). Defaults are
   * the guard-clean shape: transfers created BEFORE the refund (settlement absorbed nothing),
   * one charge on the appointment, refund old enough to clear the live-path deferral window.
   */
  async function seedStrandedUnwind(opts: {
    eventType?: string;
    chargeAmount?: number;
    amountRefunded?: number;
    tenantReversed?: number;
    cleanerReversed?: number;
    refundCreatedSecAgo?: number;
    transferCreatedSecAgo?: number;
    latestChargeAsString?: boolean;
    withCancellationFeeRow?: boolean;
    /** Cleaner slice carved but HELD (pending, no transfer) — the still-owed-payout guard case. */
    heldPayout?: boolean;
    /** Inject a 'failed' refund this many seconds ago (older than the live refund) — filter case. */
    extraFailedRefundSecAgo?: number;
  } = {}) {
    const db = createTestSupabaseClient();
    const nowSec = Math.floor(Date.now() / 1000);
    const chargeAmount = opts.chargeAmount ?? 10000;
    const amountRefunded = opts.amountRefunded ?? 10000;

    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const piId = `pi_unwind_${appt.id}`;
    const chargeId = `ch_unwind_${appt.id}`;
    const { data: payRow } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: 'refunded',
        payment_method: 'card',
        payment_type: 'revenue',
        stripe_payment_intent_id: piId,
        payment_intent_status: 'succeeded',
      })
      .select('id')
      .single();
    const paymentId = (payRow as { id: string }).id;
    if (opts.withCancellationFeeRow) {
      // A charged cancellation fee coexisting with the refunded completion charge: its transfer
      // shares the appointment's transfer group, so the sweep must NOT auto-reverse group-wide.
      await db.from('payments').insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 30,
        status: 'paid',
        payment_method: 'card',
        payment_type: 'revenue',
        charge_kind: 'cancellation_fee',
      });
    }
    const cleanerTransferId = `tr_cl_${appt.id}`;
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      // Held: carved at settlement but never transferred (cleaner not onboarded yet).
      status: opts.heldPayout ? 'pending' : 'paid',
      stripe_transfer_id: opts.heldPayout ? null : cleanerTransferId,
      payout_percent_snapshot: 60,
    });
    // The stranded failure event, older than the stale window so the sweep picks it up.
    await db.from('payment_events').insert({
      appointment_id: appt.id,
      organization_id: org.organizationId,
      payment_id: paymentId,
      event_type: opts.eventType ?? 'refund_clawback_failed',
      actor: 'webhook',
      amount: 6000,
      payload: { transfer_id: cleanerTransferId, error: 'account restricted' },
      created_at: HOUR_AGO(),
    });

    const charge = {
      id: chargeId,
      object: 'charge',
      amount: chargeAmount,
      amount_refunded: amountRefunded,
    };
    stranded.pis.set(piId, {
      id: piId,
      object: 'payment_intent',
      status: 'succeeded',
      latest_charge: opts.latestChargeAsString ? chargeId : charge,
    });
    stranded.charges.set(chargeId, charge);
    const liveRefund = {
      id: `re_${appt.id}`,
      amount: amountRefunded,
      status: 'succeeded',
      created: nowSec - (opts.refundCreatedSecAgo ?? 3600),
    };
    stranded.refunds.set(
      piId,
      opts.extraFailedRefundSecAgo != null
        ? [
            // A failed refund (no money moved) OLDER than the live one — must not drive the guards.
            {
              id: `re_failed_${appt.id}`,
              amount: amountRefunded,
              status: 'failed',
              created: nowSec - opts.extraFailedRefundSecAgo,
            },
            liveRefund,
          ]
        : [liveRefund],
    );
    const transferCreated = nowSec - (opts.transferCreatedSecAgo ?? 7200);
    const groupTransfers: Array<{ id: string; amount: number; amount_reversed: number; created: number }> = [
      {
        id: `tr_tenant_${appt.id}`,
        amount: 4000,
        amount_reversed: opts.tenantReversed ?? 0,
        created: transferCreated,
      },
    ];
    // A held cleaner slice never produced a transfer, so it isn't in the group.
    if (!opts.heldPayout) {
      groupTransfers.push({
        id: cleanerTransferId,
        amount: 6000,
        amount_reversed: opts.cleanerReversed ?? 0,
        created: transferCreated,
      });
    }
    stranded.transfers.set(`appt_${appt.id}`, groupTransfers);
    installStrandedMocks();

    return { db, appt, paymentId, piId, chargeId, cleanerTransferId };
  }

  async function markerEvents(db: ReturnType<typeof createTestSupabaseClient>, apptId: string, type: string) {
    const { data } = await db
      .from('payment_events')
      .select('amount, payload')
      .eq('appointment_id', apptId)
      .eq('event_type', type);
    return (data ?? []) as Array<{ amount: number; payload: Record<string, unknown> }>;
  }

  it('stranded refund-unwind: re-reverses the failed transfers and records the recovery marker', async () => {
    const { db, appt, cleanerTransferId } = await seedStrandedUnwind();

    const { status, body } = await callRoute<{
      strandedRefundUnwinds: { checked: number; recovered: number; stillFailed: number };
    }>(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);
    expect(body.strandedRefundUnwinds.recovered).toBeGreaterThanOrEqual(1);

    // Both legs re-reversed for the full refund: tenant $40 + cleaner $60.
    const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
    expect(reversals.find((c) => c[0] === `tr_tenant_${appt.id}`)?.[1]).toBe(4000);
    expect(reversals.find((c) => c[0] === cleanerTransferId)?.[1]).toBe(6000);

    // The terminal marker takes this appointment out of every later sweep.
    const recoveredEvents = await markerEvents(db, appt.id, 'refund_unwind_recovered');
    expect(recoveredEvents.length).toBe(1);
    expect(Number(recoveredEvents[0].amount)).toBe(10000);

    // The cleaner payout mirrors the fully-reversed transfer.
    const { data: payout } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payout as { status: string }).status).toBe('reversed');
  });

  it('stranded refund-unwind: a partial refund with one leg already reversed tops up ONLY the other leg', async () => {
    // Charge $100, $50 refunded. Tenant leg ($40) already reversed its $20 share; the cleaner
    // leg ($60, share $30) is the stranded one. A full-payout clawback here would reverse the
    // cleaner's whole $60 for a $50 refund — this pins the proportional read-then-delta math AND
    // that the refund-scoped events stay out of the full-clawback sweep.
    const { db, appt, cleanerTransferId } = await seedStrandedUnwind({
      amountRefunded: 5000,
      tenantReversed: 2000,
    });

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);

    const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
    expect(reversals.find((c) => c[0] === cleanerTransferId)?.[1]).toBe(3000);
    expect(reversals.find((c) => c[0] === `tr_tenant_${appt.id}`)).toBeUndefined();

    const recoveredEvents = await markerEvents(db, appt.id, 'refund_unwind_recovered');
    expect(recoveredEvents.length).toBe(1);
    expect(Number(recoveredEvents[0].amount)).toBe(3000);

    // Partially reversed, NOT clawed back in full: the payout row keeps its paid status.
    const { data: payout } = await db
      .from('payouts')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payout as { status: string }).status).toBe('paid');
  });

  it('stranded refund-unwind: a still-failing reversal stays stranded and alerts the platform owner', async () => {
    const { db, appt } = await seedStrandedUnwind({ eventType: 'transfer_reversal_failed' });
    vi.mocked(reversePlatformTransfer).mockRejectedValue(new Error('account still restricted'));

    try {
      const { status, body } = await callRoute<{
        strandedRefundUnwinds: { stillFailed: number };
      }>(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(status).toBe(200);
      expect(body.strandedRefundUnwinds.stillFailed).toBeGreaterThanOrEqual(1);

      // No recovery marker: the appointment re-enters the next sweep.
      expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(0);

      // The retry re-recorded both legs' failure events (tenant + cleaner).
      const { data: freshFailures } = await db
        .from('payment_events')
        .select('event_type')
        .eq('appointment_id', appt.id)
        .eq('actor', 'reconciler')
        .in('event_type', ['transfer_reversal_failed', 'refund_clawback_failed']);
      expect((freshFailures ?? []).length).toBe(2);

      // ...which raised the org-scoped critical platform alert (T1-8 substrate).
      const alertType = `payment_transfer_reversal_failed:${org.organizationId}`;
      const { data: alerts } = await db
        .from('platform_alerts')
        .select('severity')
        .eq('alert_type', alertType)
        .is('resolved_at', null);
      expect((alerts ?? []).length).toBe(1);
      expect((alerts![0] as { severity: string }).severity).toBe('critical');
    } finally {
      vi.mocked(reversePlatformTransfer).mockImplementation(
        async () => ({ id: 'trr_test' }) as never,
      );
      await db
        .from('platform_alerts')
        .delete()
        .in('alert_type', [
          `payment_transfer_reversal_failed:${org.organizationId}`,
          `payment_refund_clawback_failed:${org.organizationId}`,
        ]);
    }
  });

  it('stranded refund-unwind: a recovery marker newer than the failure excludes the appointment', async () => {
    const { db, appt, paymentId } = await seedStrandedUnwind();
    // Recovered 30 minutes ago, strictly after the hour-old failure.
    await db.from('payment_events').insert({
      appointment_id: appt.id,
      organization_id: org.organizationId,
      payment_id: paymentId,
      event_type: 'refund_unwind_recovered',
      actor: 'reconciler',
      amount: 10000,
      payload: { source: 'retry-stranded-refund-unwinds' },
      created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);

    // Not retried: no reversal touched this job's transfers and no second marker was written.
    const groupCalls = vi.mocked(listTransfersByGroup).mock.calls.map((c) => c[0]);
    expect(groupCalls).not.toContain(`appt_${appt.id}`);
    expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(1);
  });

  it('stranded refund-unwind: a transfer_list_failed strand with no actual refund terminalizes as nothing_to_unwind', async () => {
    const { db, appt, piId } = await seedStrandedUnwind({
      eventType: 'transfer_list_failed',
      amountRefunded: 0,
    });

    const first = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(first.status).toBe(200);

    const recoveredEvents = await markerEvents(db, appt.id, 'refund_unwind_recovered');
    expect(recoveredEvents.length).toBe(1);
    expect(recoveredEvents[0].payload.nothing_to_unwind).toBe(true);
    const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
    expect(reversals.find((c) => String(c[0]).includes(appt.id))).toBeUndefined();

    // Terminal for real: a second sweep never re-reads this PI from Stripe.
    const callsFor = () =>
      vi.mocked(retrievePaymentIntent).mock.calls.filter((c) => c[0] === piId).length;
    const before = callsFor();
    const second = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(second.status).toBe(200);
    expect(callsFor()).toBe(before);
  });

  it('stranded refund-unwind: a charged cancellation fee on the same appointment routes to manual review, no money moved', async () => {
    const { db, appt } = await seedStrandedUnwind({ withCancellationFeeRow: true });

    try {
      const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(status).toBe(200);

      // No reversals: the group mixes charges, auto-reversing would claw back the fee.
      const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
      expect(reversals.find((c) => String(c[0]).includes(appt.id))).toBeUndefined();

      const manualEvents = await markerEvents(db, appt.id, 'refund_unwind_manual_review');
      expect(manualEvents.length).toBe(1);
      expect(manualEvents[0].payload.mixed_charges).toBe(true);
      expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(0);

      // The manual-review marker is itself a critical owner alert.
      const alertType = `payment_refund_unwind_manual_review:${org.organizationId}:appt_${appt.id}`;
      const { data: alerts } = await db
        .from('platform_alerts')
        .select('severity')
        .eq('alert_type', alertType)
        .is('resolved_at', null);
      expect((alerts ?? []).length).toBe(1);
      expect((alerts![0] as { severity: string }).severity).toBe('critical');
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_refund_unwind_manual_review:${org.organizationId}:appt_${appt.id}`);
    }
  });

  it('stranded refund-unwind: transfers created after the refund (settlement absorbed it) route to manual review', async () => {
    // Refund 1h ago, transfers split 30min ago: settlement already excluded the refunded money
    // from the transfer sizes, so proportional-to-gross would deduct it a second time.
    const { db, appt } = await seedStrandedUnwind({
      refundCreatedSecAgo: 3600,
      transferCreatedSecAgo: 1800,
    });

    try {
      const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(status).toBe(200);

      const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
      expect(reversals.find((c) => String(c[0]).includes(appt.id))).toBeUndefined();
      const manualEvents = await markerEvents(db, appt.id, 'refund_unwind_manual_review');
      expect(manualEvents.length).toBe(1);
      expect(manualEvents[0].payload.refund_absorbed_at_settlement).toBe(true);
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_refund_unwind_manual_review:${org.organizationId}:appt_${appt.id}`);
    }
  });

  it('stranded refund-unwind: a refund younger than the stale window defers the retry (live unwind may still be acting)', async () => {
    const { db, appt } = await seedStrandedUnwind({ refundCreatedSecAgo: 60 });

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);

    // Deferred, not terminalized: no reversal, no marker of either kind — still a candidate.
    const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
    expect(reversals.find((c) => String(c[0]).includes(appt.id))).toBeUndefined();
    expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(0);
    expect((await markerEvents(db, appt.id, 'refund_unwind_manual_review')).length).toBe(0);
  });

  it('stranded refund-unwind: an unreadable PaymentIntent leaves the candidate for the next sweep, which recovers it', async () => {
    const { db, appt, piId, cleanerTransferId } = await seedStrandedUnwind();
    stranded.unreadablePis.add(piId);

    const first = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(first.status).toBe(200);
    // Neither terminalized nor reversed while Stripe is unreadable.
    expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(0);
    expect(
      vi.mocked(reversePlatformTransfer).mock.calls.find((c) => String(c[0]).includes(appt.id)),
    ).toBeUndefined();

    // Stripe comes back: the same candidate recovers on the next sweep.
    stranded.unreadablePis.delete(piId);
    const second = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(second.status).toBe(200);
    expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(1);
    expect(
      vi.mocked(reversePlatformTransfer).mock.calls.find((c) => c[0] === cleanerTransferId)?.[1],
    ).toBe(6000);
  });

  it('stranded refund-unwind: resolves a string latest_charge through retrieveCharge', async () => {
    const { db, appt } = await seedStrandedUnwind({ latestChargeAsString: true });

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);
    expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(1);
  });

  it('stranded refund-unwind: a still-owed (held) cleaner payout routes to manual review, not silent recovery', async () => {
    // The cleaner slice was carved at settlement but HELD ('pending', never transferred), then the
    // job was refunded. settleCleanerPayout will later pay that carved snapshot amount WITHOUT
    // subtracting the refund, so silently recovering here would mask a future overpay — the sweep
    // must route it to manual review instead (audit T1-1, Codex review Critical #1).
    const { db, appt } = await seedStrandedUnwind({ heldPayout: true });

    try {
      const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(status).toBe(200);

      // No money moved and no recovery marker: the still-owed slice can't be auto-reconciled.
      const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
      expect(reversals.find((c) => String(c[0]).includes(appt.id))).toBeUndefined();
      expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(0);

      const manualEvents = await markerEvents(db, appt.id, 'refund_unwind_manual_review');
      expect(manualEvents.length).toBe(1);
      expect(manualEvents[0].payload.cleaner_slice_still_owed).toBe(true);
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_refund_unwind_manual_review:${org.organizationId}:appt_${appt.id}`);
    }
  });

  it('stranded refund-unwind: a transfer created in the SAME second as the refund counts as absorbed', async () => {
    // Stripe `created` is 1-second resolution; a net-of-refund settlement landing in the same second
    // as the refund must be treated as absorbed (guard uses >=), never auto-reversed (would double-
    // deduct). Codex review High #2.
    const { db, appt } = await seedStrandedUnwind({
      refundCreatedSecAgo: 3600,
      transferCreatedSecAgo: 3600,
    });

    try {
      const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(status).toBe(200);

      const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
      expect(reversals.find((c) => String(c[0]).includes(appt.id))).toBeUndefined();
      const manualEvents = await markerEvents(db, appt.id, 'refund_unwind_manual_review');
      expect(manualEvents.length).toBe(1);
      expect(manualEvents[0].payload.refund_absorbed_at_settlement).toBe(true);
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_refund_unwind_manual_review:${org.organizationId}:appt_${appt.id}`);
    }
  });

  it('stranded refund-unwind: a failed refund does not falsely trip the settlement-absorbed guard', async () => {
    // A failed refund (returned no money) at T0, real transfers at T1, a succeeded refund at T2
    // (T0 < T1 < T2). Only the money-moving refund defines the guard; the transfers predate it, so
    // the unwind auto-recovers instead of being wrongly stranded in manual review. Codex review
    // Medium #6.
    const { db, appt, cleanerTransferId } = await seedStrandedUnwind({
      refundCreatedSecAgo: 1800, // succeeded refund, 30m ago
      transferCreatedSecAgo: 2400, // transfers, 40m ago (before the succeeded refund)
      extraFailedRefundSecAgo: 3600, // failed refund, 60m ago (before the transfers) — must be ignored
    });

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);

    // Not stranded: the failed refund's older timestamp was filtered out before the guard.
    expect((await markerEvents(db, appt.id, 'refund_unwind_manual_review')).length).toBe(0);
    expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(1);
    // Full refund → both legs reversed.
    const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
    expect(reversals.find((c) => c[0] === cleanerTransferId)?.[1]).toBe(6000);
  });

  it('stranded_refund_unwind_candidates RPC: one row per appointment, oldest strand first, attempts counted', async () => {
    const db = createTestSupabaseClient();
    const mkAppt = () =>
      createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
        status: 'completed',
        totalPrice: 100,
      });
    const apptOld = await mkAppt();
    const apptNoisy = await mkAppt();
    const failureRow = (apptId: string, minutesAgo: number, actor: string) => ({
      appointment_id: apptId,
      organization_id: org.organizationId,
      event_type: 'transfer_reversal_failed',
      actor,
      amount: 1000,
      payload: {},
      created_at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    });
    // The quiet old strand vs a noisy newer one that keeps appending failure rows: the noisy
    // appointment must neither crowd the old one out of the batch nor appear more than once.
    await db.from('payment_events').insert([
      failureRow(apptOld.id, 120, 'webhook'),
      failureRow(apptNoisy.id, 60, 'webhook'),
      failureRow(apptNoisy.id, 45, 'reconciler'),
      failureRow(apptNoisy.id, 30, 'reconciler'),
    ]);

    const { data, error } = await db.rpc('stranded_refund_unwind_candidates', {
      p_cutoff: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      p_batch: 1000,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ appointment_id: string; reconciler_attempts: number }>;

    const oldIdx = rows.findIndex((r) => r.appointment_id === apptOld.id);
    const noisyIdx = rows.findIndex((r) => r.appointment_id === apptNoisy.id);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(noisyIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeLessThan(noisyIdx); // oldest strand first
    expect(rows.filter((r) => r.appointment_id === apptNoisy.id).length).toBe(1); // deduped
    expect(rows[noisyIdx].reconciler_attempts).toBe(2); // backoff input: sweep-actor failures
  });

  it('stranded_refund_unwind_candidates RPC v2: a FRESH failure defers the whole appointment (T1-15c)', async () => {
    // v1 picked "newest failure older than the cutoff", so an appointment whose live unwind
    // failed again seconds ago was still retried this sweep against a stale timestamp, racing
    // the live path. v2 keys candidacy on the ABSOLUTE newest failure.
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const failureRow = (minutesAgo: number) => ({
      appointment_id: appt.id,
      organization_id: org.organizationId,
      event_type: 'transfer_reversal_failed',
      actor: 'webhook',
      amount: 1000,
      payload: {},
      created_at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    });
    await db.from('payment_events').insert([failureRow(120), failureRow(1)]);

    const { data, error } = await db.rpc('stranded_refund_unwind_candidates', {
      p_cutoff: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      p_batch: 1000,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ appointment_id: string }>;
    expect(rows.find((r) => r.appointment_id === appt.id)).toBeUndefined();
  });

  it('stranded_refund_unwind_candidates RPC v2: attempts count the worst TYPE, not all failure legs (T1-15c)', async () => {
    // One sweep failing both legs appends one event per type; a flat count read that as 2
    // attempts and double-advanced the exponential backoff.
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const failureRow = (type: string, minutesAgo: number) => ({
      appointment_id: appt.id,
      organization_id: org.organizationId,
      event_type: type,
      actor: 'reconciler',
      amount: 1000,
      payload: {},
      created_at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    });
    // Two sweeps, each failing both legs: 4 events, 2 per type => 2 attempts.
    await db.from('payment_events').insert([
      failureRow('transfer_reversal_failed', 120),
      failureRow('refund_clawback_failed', 120),
      failureRow('transfer_reversal_failed', 60),
      failureRow('refund_clawback_failed', 60),
    ]);

    const { data, error } = await db.rpc('stranded_refund_unwind_candidates', {
      p_cutoff: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      p_batch: 1000,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ appointment_id: string; reconciler_attempts: number }>;
    const mine = rows.find((r) => r.appointment_id === appt.id);
    expect(mine).toBeDefined();
    expect(mine!.reconciler_attempts).toBe(2);
  });

  it('stranded refund-unwind: an unreadable preflight records a bounded stall event (T1-15a)', async () => {
    const { db, appt, piId } = await seedStrandedUnwind();
    stranded.unreadablePis.add(piId);

    const { status, body } = await callRoute<{
      strandedRefundUnwinds: { deferred: number };
    }>(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);
    expect(body.strandedRefundUnwinds.deferred).toBeGreaterThanOrEqual(1);

    const stalls = await markerEvents(db, appt.id, 'refund_unwind_preflight_stalled');
    expect(stalls.length).toBe(1);
    expect(stalls[0].payload.stall_reason).toBe('charge_unreadable');
    // Not terminalized: still a candidate.
    expect((await markerEvents(db, appt.id, 'refund_unwind_manual_review')).length).toBe(0);
  });

  it('stranded refund-unwind: a DB-shape stall (no PI) exhausts to a terminal manual review (T1-15a starvation bound)', async () => {
    const { db, appt, paymentId, piId } = await seedStrandedUnwind();
    // No PaymentIntent anywhere on the appointment: nothing to re-derive from, ever — the one
    // stall class that cannot self-heal and must eventually terminalize.
    await db.from('payments').update({ stripe_payment_intent_id: null }).eq('id', paymentId);
    // 11 prior stalls in this candidacy episode (all newer than the hour-old failure event); the
    // 12th touch must terminalize instead of stalling again.
    await db.from('payment_events').insert(
      Array.from({ length: 11 }, (_, i) => ({
        appointment_id: appt.id,
        organization_id: org.organizationId,
        payment_id: paymentId,
        event_type: 'refund_unwind_preflight_stalled',
        actor: 'reconciler',
        amount: 0,
        payload: { source: 'retry-stranded-refund-unwinds', stall_reason: 'no_payment_intent' },
        created_at: new Date(Date.now() - (12 - i) * 60 * 1000).toISOString(),
      })),
    );

    try {
      const first = await callRoute<{
        strandedRefundUnwinds: { manualReview: number };
      }>(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(first.status).toBe(200);
      expect(first.body.strandedRefundUnwinds.manualReview).toBeGreaterThanOrEqual(1);

      const manualEvents = await markerEvents(db, appt.id, 'refund_unwind_manual_review');
      expect(manualEvents.length).toBe(1);
      expect(manualEvents[0].payload.preflight_exhausted).toBe(true);
      expect(manualEvents[0].payload.stall_reason).toBe('no_payment_intent');

      // The terminal marker pages the owner, keyed per APPOINTMENT (T1-15d).
      const { data: alerts } = await db
        .from('platform_alerts')
        .select('severity')
        .eq('alert_type', `payment_refund_unwind_manual_review:${org.organizationId}:appt_${appt.id}`)
        .is('resolved_at', null);
      expect((alerts ?? []).length).toBe(1);

      // Terminal for real: the marker is newer than the failure, so the appointment leaves the
      // candidate set (no new stall events on the next sweep).
      const stallCount = async () =>
        (await markerEvents(db, appt.id, 'refund_unwind_preflight_stalled')).length;
      const before = await stallCount();
      const second = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(second.status).toBe(200);
      expect(await stallCount()).toBe(before);
      expect(vi.mocked(retrievePaymentIntent).mock.calls.filter((c) => c[0] === piId).length).toBe(0);
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_refund_unwind_manual_review:${org.organizationId}:appt_${appt.id}`);
    }
  });

  it('stranded refund-unwind: a Stripe-READ stall past the budget alerts but NEVER terminalizes (money is never abandoned)', async () => {
    // A transport outage hits every candidate at once; terminalizing would permanently end
    // auto-recovery for money that heals itself when Stripe comes back.
    const { db, appt, paymentId, piId, cleanerTransferId } = await seedStrandedUnwind();
    stranded.unreadablePis.add(piId);
    await db.from('payment_events').insert(
      Array.from({ length: 11 }, (_, i) => ({
        appointment_id: appt.id,
        organization_id: org.organizationId,
        payment_id: paymentId,
        event_type: 'refund_unwind_preflight_stalled',
        actor: 'reconciler',
        amount: 0,
        payload: { source: 'retry-stranded-refund-unwinds', stall_reason: 'charge_unreadable' },
        created_at: new Date(Date.now() - (12 - i) * 60 * 1000).toISOString(),
      })),
    );

    try {
      const first = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(first.status).toBe(200);

      // No terminal marker; a deduped per-appointment critical alert pages a human instead, and
      // no 12th stall event is appended (ledger growth is bounded while the outage lasts).
      expect((await markerEvents(db, appt.id, 'refund_unwind_manual_review')).length).toBe(0);
      expect((await markerEvents(db, appt.id, 'refund_unwind_preflight_stalled')).length).toBe(11);
      const { data: alerts } = await db
        .from('platform_alerts')
        .select('severity')
        .eq('alert_type', `refund_unwind_preflight_blocked:${appt.id}`)
        .is('resolved_at', null);
      expect((alerts ?? []).length).toBe(1);
      expect((alerts![0] as { severity: string }).severity).toBe('critical');

      // Stripe heals: the SAME candidate recovers on the next sweep — candidacy was never lost.
      stranded.unreadablePis.delete(piId);
      const second = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(second.status).toBe(200);
      expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(1);
      expect(
        vi.mocked(reversePlatformTransfer).mock.calls.find((c) => c[0] === cleanerTransferId)?.[1],
      ).toBe(6000);
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `refund_unwind_preflight_blocked:${appt.id}`);
    }
  });

  it('stranded refund-unwind: a refund landing mid-iteration defers instead of reversing a stale target (T1-15b)', async () => {
    const { db, appt, chargeId } = await seedStrandedUnwind({ amountRefunded: 5000 });
    // The pre-reversal recheck re-reads the charge; a different cumulative refunded total means
    // the live unwind owns a fresh target — the sweep must defer, not reverse the stale one.
    stranded.charges.set(chargeId, {
      id: chargeId,
      object: 'charge',
      amount: 10000,
      amount_refunded: 6500,
    });

    const { status, body } = await callRoute<{
      strandedRefundUnwinds: { deferred: number };
    }>(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);
    expect(body.strandedRefundUnwinds.deferred).toBeGreaterThanOrEqual(1);

    // No money moved, no markers of any kind: still a candidate for the next sweep.
    const reversals = vi.mocked(reversePlatformTransfer).mock.calls;
    expect(reversals.find((c) => String(c[0]).includes(appt.id))).toBeUndefined();
    expect((await markerEvents(db, appt.id, 'refund_unwind_recovered')).length).toBe(0);
    expect((await markerEvents(db, appt.id, 'refund_unwind_manual_review')).length).toBe(0);
    expect((await markerEvents(db, appt.id, 'refund_unwind_preflight_stalled')).length).toBe(0);
  });
});
