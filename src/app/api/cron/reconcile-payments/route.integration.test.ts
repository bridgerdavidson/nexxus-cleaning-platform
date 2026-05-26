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

    // Benign default: any unexpected PI looks still-in-flight and is skipped.
    vi.mocked(retrievePaymentIntent).mockResolvedValue({ status: 'requires_capture' } as Stripe.PaymentIntent);
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
      payment_intent_status: 'requires_capture',
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

  it('stuck-payment: leaves a live authorization hold (requires_capture) untouched', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
    const piId = `pi_hold_${appt.id}`;
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: piId,
      payment_intent_status: 'requires_capture', // a valid hold, not drift
      created_at: HOUR_AGO(),
    });

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);
    // The hold is filtered out of the sweep — OUR PI is never retrieved, and the row is left
    // pending. (Asserted per-PI, not globally: other tests leave stale pending rows in the
    // shared DB that the sweep legitimately checks.)
    const retrievedIds = vi.mocked(retrievePaymentIntent).mock.calls.map((c) => c[0]);
    expect(retrievedIds).not.toContain(piId);
    const { data: pay } = await db
      .from('payments')
      .select('status')
      .eq('stripe_payment_intent_id', piId)
      .single();
    expect((pay as { status: string }).status).toBe('pending');
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
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'failed',
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
  });
});
