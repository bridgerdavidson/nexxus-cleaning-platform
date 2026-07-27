import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * T1-16: the unknown-charge-outcome verification sweep. A completion charge whose create threw
 * WITHOUT a PaymentIntent is recorded as a failed PI-less revenue row; Stripe may have captured
 * it. The sweep resolves each row by metadata search: repair (live PI found), verify-absent
 * (unblocks retries), or defer (young row / Stripe unreadable).
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveStripeEvent: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveCharge: vi.fn(async () => ({ amount_refunded: 0 })),
  listRefundsForPaymentIntent: vi.fn(async () => []),
  searchPaymentIntentsByAppointment: vi.fn(async () => []),
  listConnectedAccountPayouts: vi.fn(async () => []),
  retrieveConnectedAccountPayout: vi.fn(),
}));

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
  retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 0, amount_reversed: 0 })),
}));

import { POST } from './route';
import { retrievePaymentIntent, searchPaymentIntentsByAppointment } from '@/lib/stripe/reconcile';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const CRON_SECRET = 'test-cron-secret';
const cronHeaders = { Authorization: `Bearer ${CRON_SECRET}` };

interface SweepBody {
  unknownChargeOutcomes: {
    checked: number;
    repaired: number;
    verifiedAbsent: number;
    deferred: number;
  };
}

describe('POST /api/cron/reconcile-payments — verifyUnknownChargeOutcomes (T1-16)', () => {
  let org: TestOrgFixture;
  let originalSecret: string | undefined;
  const searchResults = new Map<string, Stripe.PaymentIntent[]>();

  beforeEach(async () => {
    originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_t116_cleaner',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
      platformFeeBps: 0,
    });
    searchResults.clear();
    // Per-appointment fixtures: candidates from OTHER sessions on the shared DB resolve to [] and
    // are simply deferred (young) or verified absent, never crash the sweep.
    vi.mocked(searchPaymentIntentsByAppointment).mockImplementation(
      async (apptId: string) => searchResults.get(apptId) ?? [],
    );
    // Benign default for the OTHER sweep jobs touching shared-DB rows: any unexpected PI looks
    // still-in-flight, so reconcileStuckPayments retrieves but never repairs it.
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      status: 'processing',
    } as Stripe.PaymentIntent);
  });

  afterEach(async () => {
    process.env.CRON_SECRET = originalSecret;
    await org.cleanup();
  });

  async function seedUnknownRow(opts: { selfPay?: boolean; minutesOld?: number } = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
      ...(opts.selfPay ? { selfPay: true } : {}),
    });
    await db.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
    const { data, error } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: 'failed',
        payment_method: 'card',
        payment_type: 'revenue',
        charge_kind: 'completion',
        ...(opts.selfPay ? { is_self_pay: true } : {}),
        ...(opts.minutesOld
          ? { created_at: new Date(Date.now() - opts.minutesOld * 60_000).toISOString() }
          : {}),
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed failed: ${error.message}`);
    return { db, apptId: appt.id, rowId: (data as { id: string }).id };
  }

  function succeededPi(apptId: string, opts: { selfPay?: boolean; amount?: number } = {}) {
    return {
      id: `pi_t116_${apptId}`,
      object: 'payment_intent',
      status: 'succeeded',
      amount: opts.amount ?? 10000,
      created: Math.floor(Date.now() / 1000) - 3600,
      latest_charge: `ch_t116_${apptId}`,
      metadata: {
        appointment_id: apptId,
        charge_kind: 'completion',
        ...(opts.selfPay ? { self_pay: 'true' } : {}),
      },
    } as unknown as Stripe.PaymentIntent;
  }

  async function paymentRow(db: ReturnType<typeof createTestSupabaseClient>, rowId: string) {
    const { data } = await db
      .from('payments')
      .select('status, stripe_payment_intent_id, amount, captured_at, charge_outcome_verified_at')
      .eq('id', rowId)
      .single();
    return data as {
      status: string;
      stripe_payment_intent_id: string | null;
      amount: number | string;
      captured_at: string | null;
      charge_outcome_verified_at: string | null;
    };
  }

  it('repairs a captured-but-recorded-failed homeowner charge and raises the critical alert', async () => {
    const { db, apptId, rowId } = await seedUnknownRow();
    searchResults.set(apptId, [succeededPi(apptId)]);

    try {
      const { status, body } = await callRoute<SweepBody>(POST, {
        method: 'POST',
        headers: cronHeaders,
        body: {},
      });
      expect(status).toBe(200);
      expect(body.unknownChargeOutcomes.repaired).toBeGreaterThanOrEqual(1);

      const row = await paymentRow(db, rowId);
      expect(row).toMatchObject({ status: 'paid', stripe_payment_intent_id: `pi_t116_${apptId}` });
      expect(Number(row.amount)).toBe(100);
      expect(row.captured_at).not.toBeNull();
      expect(row.charge_outcome_verified_at).not.toBeNull();

      const { data: appt } = await db
        .from('appointments')
        .select('authorization_status')
        .eq('id', apptId)
        .single();
      expect((appt as { authorization_status: string }).authorization_status).toBe('captured');

      const { data: events } = await db
        .from('payment_events')
        .select('event_type')
        .eq('appointment_id', apptId);
      expect((events ?? []).map((e) => e.event_type)).toContain('charge_outcome_recovered');

      const { data: alerts } = await db
        .from('platform_alerts')
        .select('severity')
        .eq('alert_type', `payment_charge_outcome_recovered:${org.organizationId}:appt_${apptId}`)
        .is('resolved_at', null);
      expect((alerts ?? []).length).toBe(1);
      expect((alerts![0] as { severity: string }).severity).toBe('critical');
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_charge_outcome_recovered:${org.organizationId}:appt_${apptId}`);
    }
  });

  it('repairs a self-pay row and settles the cleaner directly (settleSelfPay)', async () => {
    const { db, apptId, rowId } = await seedUnknownRow({ selfPay: true });
    searchResults.set(apptId, [succeededPi(apptId, { selfPay: true })]);

    try {
      const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
      expect(status).toBe(200);

      const row = await paymentRow(db, rowId);
      expect(row.status).toBe('paid');

      // settleSelfPay ran: the cleaner payout row exists and is paid (60% of the $100 job).
      const { data: payout } = await db
        .from('payouts')
        .select('status, amount, is_self_pay')
        .eq('appointment_id', apptId)
        .maybeSingle();
      expect(payout).toMatchObject({ status: 'paid', is_self_pay: true });
      expect(Number((payout as { amount: number | string }).amount)).toBe(60);
    } finally {
      await db
        .from('platform_alerts')
        .delete()
        .eq('alert_type', `payment_charge_outcome_recovered:${org.organizationId}:appt_${apptId}`);
    }
  });

  it('stamps verified-absent (unblocking retries) when Stripe has no charge and the row is old enough', async () => {
    const { db, apptId, rowId } = await seedUnknownRow({ minutesOld: 30 });
    // No search fixture: Stripe reports no completion PI for this appointment.

    const { status, body } = await callRoute<SweepBody>(POST, {
      method: 'POST',
      headers: cronHeaders,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.unknownChargeOutcomes.verifiedAbsent).toBeGreaterThanOrEqual(1);

    const row = await paymentRow(db, rowId);
    expect(row.status).toBe('failed');
    expect(row.stripe_payment_intent_id).toBeNull();
    expect(row.charge_outcome_verified_at).not.toBeNull();

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', apptId);
    expect((events ?? []).map((e) => e.event_type)).toContain('charge_outcome_verified_absent');
  });

  it('defers a row too young for an absence verdict (search indexing lag)', async () => {
    const { db, rowId } = await seedUnknownRow();

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);

    const row = await paymentRow(db, rowId);
    expect(row.status).toBe('failed');
    expect(row.charge_outcome_verified_at).toBeNull();
  });

  it('never adopts the WRONG leg: a self-pay PI does not repair a homeowner row', async () => {
    const { db, apptId, rowId } = await seedUnknownRow({ minutesOld: 30 });
    searchResults.set(apptId, [succeededPi(apptId, { selfPay: true })]);

    const { status } = await callRoute(POST, { method: 'POST', headers: cronHeaders, body: {} });
    expect(status).toBe(200);

    // Not repaired from the mismatched leg; with no matching PI the old row verifies absent.
    const row = await paymentRow(db, rowId);
    expect(row.stripe_payment_intent_id).toBeNull();
    expect(row.status).toBe('failed');
    expect(row.charge_outcome_verified_at).not.toBeNull();
  });
});
