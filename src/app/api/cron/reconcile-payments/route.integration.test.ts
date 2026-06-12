import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

// Stripe reads go through @/lib/stripe/reconcile (which calls getStripe(), stubbed to throw by
// the global setup). Mock it so the sweep runs against the real DB with controlled Stripe data.
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
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
import { retrieveStripeEvent, retrievePaymentIntent } from '@/lib/stripe/reconcile';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
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
    });

    // Benign default: any unexpected PI looks still-in-flight (non-terminal), so the sweep retrieves
    // it but doesn't repair it.
    vi.mocked(retrievePaymentIntent).mockResolvedValue({ status: 'processing' } as Stripe.PaymentIntent);
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
    // The check derives gross from the recorded PAYMENT (M1), so seed the $100 charge it splits.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_mm_${appt.id}`,
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
  });

  it('money-math: a payer-funded processing fee does not flag a correct payout (M1)', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    // Fee passthrough: the charge was $103.30 with a $3.30 fee — the split base is still $100,
    // so the $60 payout is CORRECT. The old total_price-derived check was fine here, but a
    // charge-amount-derived check must subtract the fee or it would expect 60% of $103.30.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 103.3,
      processing_fee_cents: 330,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_mmfee_${appt.id}`,
    });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'paid',
      payout_percent_snapshot: 60,
    });

    const { status } = await callRoute<{ moneyMath: { violations: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);

    const { data: events } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'money_math_violation');
    expect((events ?? []).length).toBe(0);
  });

  it('money-math: validates a self-pay payout against the exact cut, not a percent of captured', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
      orgOwnedProperty: true,
      selfPay: true,
    });
    // Self-pay: the charge is grossed UP above the job price to cover Stripe's fee. The cleaner
    // is owed the exact cut of job price x percent ($60), never 60% of the captured amount.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 62.11,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      is_self_pay: true,
      stripe_payment_intent_id: `pi_mmsp_${appt.id}`,
    });
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'paid',
      payout_percent_snapshot: 60,
      is_self_pay: true,
    });

    const { status } = await callRoute<{ moneyMath: { violations: number } }>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);

    const { data: events } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'money_math_violation');
    expect((events ?? []).length).toBe(0);
  });
});
