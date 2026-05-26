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

// Dispute-lost clawback reverses the tenant→cleaner transfer via this module (which would
// otherwise call getStripe() and throw under the test mock).
vi.mock('@/lib/stripe/charges/refund', () => ({
  createRefund: vi.fn(async () => ({ id: 're_test' })),
  reverseCleanerTransfer: vi.fn(async () => ({ id: 'trr_test' })),
}));

import { POST } from './route';
import { createTenantToCleanerTransfer } from '@/lib/stripe/transfers';
import { reverseCleanerTransfer } from '@/lib/stripe/charges/refund';
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
      // Unique per run (so webhook_events from a previous run can't pre-empt it), but
      // identical across the two deliveries below — the point of the idempotency test.
      eventId: `evt_test_idempotent_${appt.id}`,
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

  // ── Phase 4b: idempotency ledger + dispute / refund confirmation ──────────────
  it('records the event in webhook_events and skips a duplicate delivery', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
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
      eventId: `evt_wh_${appt.id}`,
    });
    const payload = JSON.stringify(event);
    const sig = signWebhookPayload(payload);

    const res1 = await callRoute<{ duplicate?: boolean }>(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res1.status).toBe(200);
    expect(res1.body.duplicate).toBeUndefined();

    const { data: ev } = await admin
      .from('webhook_events')
      .select('status, type')
      .eq('id', `evt_wh_${appt.id}`)
      .single();
    expect((ev as { status: string }).status).toBe('processed');

    const res2 = await callRoute<{ duplicate?: boolean }>(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res2.status).toBe(200);
    expect(res2.body.duplicate).toBe(true);

    // Cleanup the global (non-org-scoped) webhook_events row this test created.
    await admin.from('webhook_events').delete().eq('id', `evt_wh_${appt.id}`);
  });

  function buildDisputeEvent(opts: {
    type: 'charge.dispute.created' | 'charge.dispute.closed';
    appointmentId: string;
    status: string;
    amountCents: number;
  }) {
    return {
      id: `evt_disp_${opts.type}_${opts.appointmentId}`,
      object: 'event',
      type: opts.type,
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `dp_${opts.appointmentId}`,
          object: 'dispute',
          amount: opts.amountCents,
          charge: `ch_${opts.appointmentId}`,
          payment_intent: `pi_test_${opts.appointmentId}`,
          reason: 'fraudulent',
          status: opts.status,
          evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 },
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
  }

  it('charge.dispute.created records a dispute against the tenant org', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const admin = createTestSupabaseClient();
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const payload = JSON.stringify(
      buildDisputeEvent({ type: 'charge.dispute.created', appointmentId: appt.id, status: 'needs_response', amountCents: 10000 }),
    );
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data: disputes } = await admin
      .from('disputes')
      .select('organization_id, amount, status, reason')
      .eq('stripe_dispute_id', `dp_${appt.id}`);
    expect(disputes).toHaveLength(1);
    const d = disputes![0] as { organization_id: string; amount: number; status: string; reason: string };
    expect(d.organization_id).toBe(org.organizationId);
    expect(Number(d.amount)).toBe(10000);
    expect(d.status).toBe('needs_response');
  });

  it('charge.dispute.closed (lost) claws back the cleaner transfer', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const admin = createTestSupabaseClient();
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });
    await admin.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'paid',
      stripe_transfer_id: 'tr_clawback',
      source_balance_account_id: 'acct_tenant',
    });

    const payload = JSON.stringify(
      buildDisputeEvent({ type: 'charge.dispute.closed', appointmentId: appt.id, status: 'lost', amountCents: 10000 }),
    );
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Full cleaner share reversed from the tenant balance.
    expect(vi.mocked(reverseCleanerTransfer)).toHaveBeenCalledWith('tr_clawback', 6000, 'acct_tenant');

    const { data: payouts } = await admin
      .from('payouts')
      .select('status')
      .eq('appointment_id', appt.id);
    expect((payouts![0] as { status: string }).status).toBe('reversed');
  });

  it('charge.refunded marks the refund succeeded and the payment refunded', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const admin = createTestSupabaseClient();
    const { data: pay } = await admin
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: 'paid',
        payment_method: 'card',
        payment_type: 'revenue',
        stripe_payment_intent_id: `pi_test_${appt.id}`,
      })
      .select('id')
      .single();
    await admin.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: (pay as { id: string }).id,
      appointment_id: appt.id,
      stripe_refund_id: `re_${appt.id}`,
      amount: 10000,
      initiator_user_id: org.admin.userId,
      status: 'pending',
    });

    const event = {
      id: `evt_refund_${appt.id}`,
      object: 'event',
      type: 'charge.refunded',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `ch_${appt.id}`,
          object: 'charge',
          amount: 10000,
          amount_refunded: 10000,
          payment_intent: `pi_test_${appt.id}`,
          refunds: { object: 'list', data: [{ id: `re_${appt.id}`, object: 'refund' }] },
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
    const payload = JSON.stringify(event);
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data: refunds } = await admin
      .from('refunds')
      .select('status')
      .eq('stripe_refund_id', `re_${appt.id}`);
    expect((refunds![0] as { status: string }).status).toBe('succeeded');

    const { data: payment } = await admin
      .from('payments')
      .select('status')
      .eq('id', (pay as { id: string }).id)
      .single();
    expect((payment as { status: string }).status).toBe('refunded');
  });

  it('payment_intent.canceled reschedules re-auth when the appointment still claims a dead hold', async () => {
    const admin = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
    await admin
      .from('appointments')
      .update({ authorization_status: 'authorized', reauth_count: 0, payment_method_id: 'pm_x' })
      .eq('id', appt.id);
    const piId = `pi_test_${appt.id}`;
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: piId,
      payment_intent_status: 'requires_capture',
    });

    const eventId = `evt_pi_cancel_${appt.id}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'payment_intent.canceled',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: piId, object: 'payment_intent', status: 'canceled', metadata: { appointment_id: appt.id } } },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
    const payload = JSON.stringify(event);
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data: a } = await admin
      .from('appointments')
      .select('authorization_status, reauth_count')
      .eq('id', appt.id)
      .single();
    // Dead hold + active appointment → reset to scheduled (JIT re-authorizes) with a bumped count.
    expect((a as { authorization_status: string }).authorization_status).toBe('scheduled');
    expect((a as { reauth_count: number }).reauth_count).toBe(1);

    await admin.from('webhook_events').delete().eq('id', eventId);
  });

  it('refund.failed marks the refunds row failed so it stops counting against the cap', async () => {
    const admin = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { data: pay } = await admin
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: 'paid',
        payment_method: 'card',
        payment_type: 'revenue',
        stripe_payment_intent_id: `pi_test_${appt.id}`,
      })
      .select('id')
      .single();
    await admin.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: (pay as { id: string }).id,
      appointment_id: appt.id,
      stripe_refund_id: `re_fail_${appt.id}`,
      amount: 5000,
      initiator_user_id: org.admin.userId,
      status: 'pending',
    });

    const eventId = `evt_refund_failed_${appt.id}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'refund.failed',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `re_fail_${appt.id}`, object: 'refund', status: 'failed', amount: 5000, payment_intent: `pi_test_${appt.id}` } },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
    const payload = JSON.stringify(event);
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data: r } = await admin.from('refunds').select('status').eq('stripe_refund_id', `re_fail_${appt.id}`);
    expect((r![0] as { status: string }).status).toBe('failed');

    await admin.from('webhook_events').delete().eq('id', eventId);
  });

  it('payout.paid without resolvable transfer ids marks only the OLDEST payout, not all', async () => {
    const admin = createTestSupabaseClient();
    const apptOld = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const apptNew = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { data: oldRow } = await admin
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: apptOld.id,
        amount: 60,
        status: 'paid',
        created_at: new Date(Date.now() - 3600_000).toISOString(),
      })
      .select('id')
      .single();
    const { data: newRow } = await admin
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: apptNew.id,
        amount: 70,
        status: 'paid',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // getPayoutTransferIds is globally mocked to return [] → the handler hits the narrowed
    // fallback, which must touch only one payout. event.account matches the cleaner's account.
    const eventId = `evt_payout_paid_${org.organizationId.slice(0, 8)}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'payout.paid',
      account: 'acct_test_fake',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'po_test_1', object: 'payout', amount: 6000, arrival_date: Math.floor(Date.now() / 1000) } },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
    const payload = JSON.stringify(event);
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const oldId = (oldRow as { id: string }).id;
    const newId = (newRow as { id: string }).id;
    const { data: oldAfter } = await admin.from('payouts').select('status, stripe_payout_id').eq('id', oldId).single();
    const { data: newAfter } = await admin.from('payouts').select('status, stripe_payout_id').eq('id', newId).single();
    // Oldest → bank_paid (stamped with this payout); the newer one is left untouched.
    expect((oldAfter as { status: string }).status).toBe('bank_paid');
    expect((oldAfter as { stripe_payout_id: string }).stripe_payout_id).toBe('po_test_1');
    expect((newAfter as { status: string }).status).toBe('paid');
    expect((newAfter as { stripe_payout_id: string | null }).stripe_payout_id).toBeNull();

    await admin.from('webhook_events').delete().eq('id', eventId);
  });

  // ── Phase 5: SaaS subscription state mirroring (Scenario 3) ───────────────────
  it('customer.subscription.updated mirrors subscription state onto the org', async () => {
    const admin = createTestSupabaseClient();
    const eventId = `evt_sub_upd_${org.organizationId.slice(0, 8)}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'customer.subscription.updated',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'sub_mirror_1',
          object: 'subscription',
          status: 'active',
          customer: 'cus_unused_here',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          metadata: { organization_id: org.organizationId },
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
    const payload = JSON.stringify(event);
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data: o } = await admin
      .from('organizations')
      .select('subscription_id, subscription_status, subscription_current_period_end')
      .eq('id', org.organizationId)
      .single();
    const row = o as { subscription_id: string; subscription_status: string; subscription_current_period_end: string | null };
    expect(row.subscription_id).toBe('sub_mirror_1');
    expect(row.subscription_status).toBe('active');
    expect(row.subscription_current_period_end).not.toBeNull();

    const { data: ev } = await admin
      .from('tenant_subscription_events')
      .select('event_type')
      .eq('stripe_event_id', eventId);
    expect((ev ?? []).length).toBe(1);

    await admin.from('webhook_events').delete().eq('id', eventId);
  });

  it('invoice.payment_failed records a subscription audit event for the org', async () => {
    const admin = createTestSupabaseClient();
    const customerId = `cus_inv_${org.organizationId.slice(0, 8)}`;
    await admin.from('organizations').update({ stripe_customer_id: customerId }).eq('id', org.organizationId);

    const eventId = `evt_inv_fail_${org.organizationId.slice(0, 8)}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'invoice.payment_failed',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: { id: 'in_1', object: 'invoice', customer: customerId, status: 'open', amount_paid: 0, amount_due: 5000 },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
    const payload = JSON.stringify(event);
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data: ev } = await admin
      .from('tenant_subscription_events')
      .select('event_type')
      .eq('stripe_event_id', eventId);
    expect((ev ?? []).length).toBe(1);
    expect((ev![0] as { event_type: string }).event_type).toBe('invoice.payment_failed');

    await admin.from('webhook_events').delete().eq('id', eventId);
  });
});
