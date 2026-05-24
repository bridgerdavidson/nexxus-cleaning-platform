import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Destination-charge cleaner settlement goes through @/lib/stripe/transfers (which calls
// getStripe(), stubbed to throw by the global setup). Mock it so settleCleanerPayout runs
// against the real DB with stubbed Stripe transfer calls.
vi.mock('@/lib/stripe/transfers', () => ({
  resolveTenantChargeId: vi.fn(async () => 'py_tenant_charge'),
  createTenantToCleanerTransfer: vi.fn(async (p: { appointmentId: string; amountCents: number }) => ({
    id: `tr_cleaner_${p.appointmentId}`,
    amount: p.amountCents,
  })),
}));

import { POST } from './route';
import { createTenantToCleanerTransfer } from '@/lib/stripe/transfers';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  buildPaymentIntentSucceededEvent,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { signWebhookPayload, type StripeFake } from '../../../../../tests/helpers/stripe';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/stripe/webhook', () => {
  let org: TestOrgFixture;
  let fake: StripeFake;

  beforeEach(async () => {
    fake = globalThis.__stripeFake as StripeFake;
    fake.reset();
    // Cleaner is fully onboarded so the route reaches the transfer step.
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_test_fake',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('rejects requests with invalid signature → 400', async () => {
    const payload = JSON.stringify({ id: 'evt_invalid', type: 'payment_intent.succeeded' });
    const { status } = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': 't=0,v1=bogus' },
      body: payload,
    });
    expect(status).toBe(400);
  });

  it('replaying payment_intent.succeeded creates exactly ONE transfer (idempotency)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });

    // Seed a pending payment row so the route's payments update has a target.
    const admin = createTestSupabaseClient();
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const event = buildPaymentIntentSucceededEvent({
      appointmentId: appt.id,
      amountDollars: 100,
      eventId: 'evt_test_idempotent',
    });
    const payload = JSON.stringify(event);
    const sig = signWebhookPayload(payload);

    // First delivery
    const res1 = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res1.status).toBe(200);

    // Second delivery (simulating Stripe's automatic retry)
    const res2 = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res2.status).toBe(200);

    // Fake records exactly one transfer call (idempotency-key short-circuit).
    expect(fake.transferCalls).toHaveLength(1);
    expect(fake.transferCalls[0].idempotencyKey).toBe(`payout-${appt.id}`);
    // 60% of $100 = $60.00 = 6000 cents — the route passes cents to createConnectTransfer.
    expect(fake.transferCalls[0].amount).toBe(6000);

    // Exactly one payouts row.
    const { data: payouts } = await admin
      .from('payouts')
      .select('id, amount')
      .eq('appointment_id', appt.id);
    expect(payouts).toHaveLength(1);
    expect(Number((payouts![0] as { amount: number }).amount)).toBe(60);
  });

  it('skips transfer when stripe_connect_onboarding_complete=false', async () => {
    // Mutate cleaner profile to mark onboarding incomplete.
    const admin = createTestSupabaseClient();
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: false })
      .eq('id', org.cleaner.userId);

    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
    });
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const event = buildPaymentIntentSucceededEvent({ appointmentId: appt.id, amountDollars: 100 });
    const payload = JSON.stringify(event);
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(fake.transferCalls).toHaveLength(0);
  });

  it('skips transfer when payout_percent=0', async () => {
    const admin = createTestSupabaseClient();
    await admin
      .from('cleaner_profiles')
      .update({ payout_percent: 0 })
      .eq('id', org.cleaner.userId);

    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
    });
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const event = buildPaymentIntentSucceededEvent({ appointmentId: appt.id, amountDollars: 100 });
    const payload = JSON.stringify(event);
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(fake.transferCalls).toHaveLength(0);
  });

  it('returns 400 with no stripe-signature header', async () => {
    const payload = JSON.stringify({ id: 'evt_no_sig', type: 'payment_intent.succeeded' });
    const { status } = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      body: payload,
    });
    expect(status).toBe(400);
  });

  // ── Phase 3: destination-charge cleaner settlement (tenant balance → cleaner) ──
  function buildDestinationChargeEvent(appointmentId: string, amountDollars: number, tenantAccount: string) {
    return {
      id: `evt_dc_${appointmentId}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_test_${appointmentId}`,
          object: 'payment_intent',
          amount: Math.round(amountDollars * 100),
          currency: 'usd',
          status: 'succeeded',
          latest_charge: `ch_test_${appointmentId}`,
          transfer_data: { destination: tenantAccount },
          metadata: { appointment_id: appointmentId },
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
  }

  async function seedForSettlement(opts: { hourly?: boolean } = {}) {
    const admin = createTestSupabaseClient();
    const tenantAccount = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    await admin
      .from('organizations')
      .update({ stripe_connect_account_id: tenantAccount })
      .eq('id', org.organizationId);
    if (opts.hourly) {
      await admin
        .from('cleaner_profiles')
        .update({ payout_model: 'hourly_external' })
        .eq('id', org.cleaner.userId);
    }
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });
    return { appt, tenantAccount };
  }

  it('destination charge settles the cleaner from the tenant balance (not the platform)', async () => {
    const { appt, tenantAccount } = await seedForSettlement();
    const payload = JSON.stringify(buildDestinationChargeEvent(appt.id, 100, tenantAccount));
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Legacy platform→cleaner transfer NOT used; tenant→cleaner transfer used instead.
    expect(fake.transferCalls).toHaveLength(0);
    expect(vi.mocked(createTenantToCleanerTransfer)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(createTenantToCleanerTransfer).mock.calls[0][0];
    expect(call.amountCents).toBe(6000); // 60% of $100
    expect(call.tenantAccountId).toBe(tenantAccount);

    const admin = createTestSupabaseClient();
    const { data: payouts } = await admin
      .from('payouts')
      .select('amount, status, source_balance_account_id')
      .eq('appointment_id', appt.id);
    expect(payouts).toHaveLength(1);
    const payout = payouts![0] as { amount: number; status: string; source_balance_account_id: string };
    expect(Number(payout.amount)).toBe(60);
    expect(payout.status).toBe('paid');
    expect(payout.source_balance_account_id).toBe(tenantAccount);
  });

  it('destination charge does NOT pay an hourly_external cleaner', async () => {
    const { appt, tenantAccount } = await seedForSettlement({ hourly: true });
    const payload = JSON.stringify(buildDestinationChargeEvent(appt.id, 100, tenantAccount));
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(createTenantToCleanerTransfer)).not.toHaveBeenCalled();

    const admin = createTestSupabaseClient();
    const { data: payouts } = await admin.from('payouts').select('id').eq('appointment_id', appt.id);
    expect(payouts ?? []).toHaveLength(0);
  });
});
