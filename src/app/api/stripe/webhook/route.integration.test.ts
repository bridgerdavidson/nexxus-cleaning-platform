import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
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
});
