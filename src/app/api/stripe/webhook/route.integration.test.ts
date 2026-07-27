import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Settlement + refund go through @/lib/stripe/transfers (platform→connected transfers, which
// call getStripe(), stubbed to throw by the global setup). Mock the module so settleCleanerPayout
// runs against the real DB with stubbed Stripe transfer calls. transferGroupFor is pure — keep a
// real impl so the group tag matches what the refund path computes.
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

vi.mock('@/lib/stripe/charges/refund', () => ({
  createRefund: vi.fn(async () => ({ id: 're_test' })),
}));

import { POST } from './route';
import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { createPlatformTransfer, reversePlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import { getPayoutTransferIds } from '@/lib/stripe';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  createTestPayRequest,
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
    // Cleaner is fully onboarded so the route reaches the transfer step. platform_fee_bps is
    // PINNED to 0: this suite tests split/settlement mechanics, and the DB default changed to
    // 100 in migration 111 (the dedicated platform-fee test overrides to 100 itself).
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_test_fake',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
      platformFeeBps: 0,
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

  it('verifies a connected-account event signed with STRIPE_CONNECT_WEBHOOK_SECRET', async () => {
    const prev = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test_secret';
    try {
      const event = {
        id: `evt_connect_${Date.now()}`,
        object: 'event',
        type: 'account.updated',
        account: 'acct_unmatched_test',
        data: {
          object: {
            id: 'acct_unmatched_test',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements: { currently_due: [] },
          },
        },
      };
      const payload = JSON.stringify(event);
      // Signed with the CONNECT secret, not STRIPE_WEBHOOK_SECRET — only verifies if the route
      // tries the second secret. The account matches no org/cleaner, so the handler no-ops → 200.
      const signature = signWebhookPayload(payload, 'whsec_connect_test_secret');
      const { status, body } = await callRoute<{ received?: boolean }>(POST, {
        method: 'POST',
        url: 'http://test.local/api/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        body: payload,
      });
      expect(status).toBe(200);
      expect(body.received).toBe(true);
    } finally {
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET = prev;
    }
  });

  it('setup_intent.succeeded (card link) re-points the homeowner\'s stuck appointments onto the new card', async () => {
    const admin = createTestSupabaseClient();
    // A homeowner appointment stuck needing 3-D Secure (off-session charge returned requires_action).
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
    await admin
      .from('appointments')
      .update({ authorization_status: 'requires_action', payment_method_id: 'pm_old_needs_auth' })
      .eq('id', appt.id);

    const token = `tok_test_${appt.id}`;
    await admin.from('homeowner_payment_links').insert({
      homeowner_id: org.homeowner.userId,
      organization_id: org.organizationId,
      token,
      status: 'pending',
      created_by: org.admin.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const event = {
      id: `evt_si_${appt.id}`,
      object: 'event',
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'seti_test_recovery',
          object: 'setup_intent',
          status: 'succeeded',
          payment_method: 'pm_new_authed_card',
          metadata: { token },
        },
      },
    };
    const payload = JSON.stringify(event);
    const sig = signWebhookPayload(payload);
    const { status } = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      body: payload,
    });
    expect(status).toBe(200);

    // The card link is marked completed AND the stuck appointment is re-pointed onto the new,
    // now-authenticated card with its failed state cleared (it reads "Unpaid" and is charged when
    // the job is completed).
    const { data: linkRow } = await admin
      .from('homeowner_payment_links')
      .select('status')
      .eq('token', token)
      .single();
    expect((linkRow as { status: string }).status).toBe('completed');

    const { data: apptRow } = await admin
      .from('appointments')
      .select('authorization_status, payment_method_id')
      .eq('id', appt.id)
      .single();
    const a = apptRow as {
      authorization_status: string | null;
      payment_method_id: string;
    };
    expect(a.authorization_status).toBeNull();
    expect(a.payment_method_id).toBe('pm_new_authed_card');
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

  // ── Phase 3: separate charges & transfers settlement (platform → tenant + cleaner) ──
  // The new-flow PI carries `on_behalf_of` (tenant = merchant of record) and NO transfer_data;
  // funds are on the platform and settlement fans them out via platform transfers.
  function buildSeparateChargeEvent(appointmentId: string, amountDollars: number, tenantAccount: string) {
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
          amount_received: Math.round(amountDollars * 100),
          currency: 'usd',
          status: 'succeeded',
          latest_charge: `ch_test_${appointmentId}`,
          on_behalf_of: tenantAccount,
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

  it('separate charges & transfers settles BOTH the tenant remainder and the cleaner % from the platform', async () => {
    const { appt, tenantAccount } = await seedForSettlement();
    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 100, tenantAccount));
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Legacy platform→cleaner path NOT used; two PLATFORM transfers instead (never connected→connected).
    expect(fake.transferCalls).toHaveLength(0);
    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    const cleanerCall = calls.find((c) => c.destinationAccountId === 'acct_test_fake');
    const tenantCall = calls.find((c) => c.destinationAccountId === tenantAccount);
    expect(cleanerCall?.amountCents).toBe(6000); // 60% of $100
    expect(tenantCall?.amountCents).toBe(4000); // remainder = gross − cleaner − fee

    const admin = createTestSupabaseClient();
    const { data: payouts } = await admin
      .from('payouts')
      .select('amount, status')
      .eq('appointment_id', appt.id);
    expect(payouts).toHaveLength(1);
    const payout = payouts![0] as { amount: number; status: string };
    expect(Number(payout.amount)).toBe(60);
    expect(payout.status).toBe('paid');
  });

  it('platform_fee_bps=100 retains 1% on the platform: cleaner keeps the full %, tenant remainder shrinks', async () => {
    const admin = createTestSupabaseClient();
    await admin.from('organizations').update({ platform_fee_bps: 100 }).eq('id', org.organizationId);
    const { appt, tenantAccount } = await seedForSettlement();
    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 100, tenantAccount));
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    const cleanerCall = calls.find((c) => c.destinationAccountId === 'acct_test_fake');
    const tenantCall = calls.find((c) => c.destinationAccountId === tenantAccount);
    expect(cleanerCall?.amountCents).toBe(6000); // still 60% of the $100 gross, never fee-shaved
    expect(tenantCall?.amountCents).toBe(3900); // remainder = 10000 − 6000 − 100 fee
    // The 100-cent fee is what STAYS on the platform: transfers total gross − fee.
    expect((cleanerCall?.amountCents ?? 0) + (tenantCall?.amountCents ?? 0)).toBe(9900);
  });

  it('does NOT pay an hourly_external cleaner — the whole amount goes to the tenant', async () => {
    const { appt, tenantAccount } = await seedForSettlement({ hourly: true });
    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 100, tenantAccount));
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Only the tenant transfer (full amount); no cleaner transfer, no payout row.
    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].destinationAccountId).toBe(tenantAccount);
    expect(calls[0].amountCents).toBe(10000);

    const admin = createTestSupabaseClient();
    const { data: payouts } = await admin.from('payouts').select('id').eq('appointment_id', appt.id);
    expect(payouts ?? []).toHaveLength(0);
  });

  // ── Pay-request + flat settlement (migration 114): the cleaner amount comes
  // from the approved thread / flat rate instead of a percent, and settlement
  // DEFERS entirely while a request thread is unapproved. ──

  it('request mode: an APPROVED thread settles at the approved amount with provenance columns', async () => {
    const admin = createTestSupabaseClient();
    await admin.from('cleaner_profiles').update({ payout_model: 'request' }).eq('id', org.cleaner.userId);
    const { appt, tenantAccount } = await seedForSettlement();
    const pr = await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'approved',
      jobPriceCents: 10000,
      approvedAmountCents: 7200,
      approvedVia: 'org',
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 7200, minMarginBpsSnapshot: 2000 }],
    });

    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 100, tenantAccount));
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.destinationAccountId === 'acct_test_fake')?.amountCents).toBe(7200);
    expect(calls.find((c) => c.destinationAccountId === tenantAccount)?.amountCents).toBe(2800); // fee pinned 0

    const { data: payouts } = await admin
      .from('payouts')
      .select('amount, status, payout_percent_snapshot, payout_model_snapshot, pay_request_id')
      .eq('appointment_id', appt.id);
    expect(payouts).toHaveLength(1);
    const payout = payouts![0] as Record<string, unknown>;
    expect(Number(payout.amount)).toBe(72);
    expect(payout.status).toBe('paid');
    expect(payout.payout_percent_snapshot).toBeNull();
    expect(payout.payout_model_snapshot).toBe('request');
    expect(payout.pay_request_id).toBe(pr.id);
  });

  it('request mode: a PENDING thread defers BOTH legs, then settles once approved', async () => {
    const admin = createTestSupabaseClient();
    await admin.from('cleaner_profiles').update({ payout_model: 'request' }).eq('id', org.cleaner.userId);
    const { appt, tenantAccount } = await seedForSettlement();
    const pr = await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'pending_org',
      jobPriceCents: 10000,
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 9500, minMarginBpsSnapshot: 2000 }],
    });

    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 100, tenantAccount));
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    // No money moved - not even the tenant leg (its remainder depends on the cleaner amount).
    expect(vi.mocked(createPlatformTransfer).mock.calls).toHaveLength(0);
    const { data: events } = await admin
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    expect((events as { event_type: string }[]).map((e) => e.event_type)).toContain(
      'settlement_deferred_pay_request',
    );

    // Approve at $85 and re-settle the reconcile way (no capturedCents).
    await admin
      .from('pay_requests')
      .update({
        status: 'approved',
        approved_amount_cents: 8500,
        approved_via: 'org',
        approved_by: org.admin.userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pr.id);
    const result = await settleCleanerPayout(admin, appt.id, null);
    expect(result.settled).toBe(true);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.destinationAccountId === 'acct_test_fake')?.amountCents).toBe(8500);
    expect(calls.find((c) => c.destinationAccountId === tenantAccount)?.amountCents).toBe(1500);
  });

  it('flat mode: pays min(flat rate, base) and records payout_flat_capped when the rate exceeds the job', async () => {
    const admin = createTestSupabaseClient();
    await admin
      .from('cleaner_profiles')
      .update({ payout_model: 'flat', flat_rate_cents: 9500, payout_percent: 0 })
      .eq('id', org.cleaner.userId);
    const { appt, tenantAccount } = await seedForSettlement();
    // Shrink the job under the flat rate: captured $80.
    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 80, tenantAccount));
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.destinationAccountId === 'acct_test_fake')?.amountCents).toBe(8000);

    const { data: payouts } = await admin
      .from('payouts')
      .select('amount, payout_model_snapshot, payout_percent_snapshot')
      .eq('appointment_id', appt.id);
    const payout = (payouts ?? [])[0] as Record<string, unknown>;
    expect(Number(payout.amount)).toBe(80);
    expect(payout.payout_model_snapshot).toBe('flat');
    expect(payout.payout_percent_snapshot).toBeNull();

    const { data: events } = await admin
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    expect((events as { event_type: string }[]).map((e) => e.event_type)).toContain('payout_flat_capped');
  });

  it('never settles into an open dispute (deferred-approval window)', async () => {
    const admin = createTestSupabaseClient();
    const { appt, tenantAccount } = await seedForSettlement();
    const { data: payRow } = await admin
      .from('payments')
      .select('id')
      .eq('appointment_id', appt.id)
      .single();
    await admin.from('disputes').insert({
      organization_id: org.organizationId,
      payment_id: (payRow as { id: string }).id,
      stripe_dispute_id: `dp_test_${appt.id}`,
      stripe_charge_id: `ch_test_${appt.id}`,
      amount: 10000,
      status: 'needs_response',
    });

    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 100, tenantAccount));
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    expect(vi.mocked(createPlatformTransfer).mock.calls).toHaveLength(0);
    const { data: events } = await admin
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    expect((events as { event_type: string }[]).map((e) => e.event_type)).toContain(
      'settlement_blocked_dispute_open',
    );
  });

  it('fee passthrough: settles on the SERVICE PRICE, not the captured amount that includes the fee', async () => {
    const admin = createTestSupabaseClient();
    const tenantAccount = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    await admin
      .from('organizations')
      .update({ stripe_connect_account_id: tenantAccount })
      .eq('id', org.organizationId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 100,
    });
    // The payer was charged $103.30 ($100 service + $3.30 card fee). The recorded fee means
    // settlement distributes only the $100 base — Stripe consumed the fee.
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 103.3,
      processing_fee_cents: 330,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const payload = JSON.stringify(buildSeparateChargeEvent(appt.id, 103.3, tenantAccount));
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    const cleanerCall = calls.find((c) => c.destinationAccountId === 'acct_test_fake');
    const tenantCall = calls.find((c) => c.destinationAccountId === tenantAccount);
    // 60% of the $100 SERVICE PRICE = $60.00 — NOT 60% of the $103.30 charge ($61.98).
    expect(cleanerCall?.amountCents).toBe(6000);
    // Remainder of the base: $100 − $60 − $0 platform fee = $40.00.
    expect(tenantCall?.amountCents).toBe(4000);
    // Transfers out total $100, which is what the platform nets after Stripe's fee — never negative.
    expect((cleanerCall?.amountCents ?? 0) + (tenantCall?.amountCents ?? 0)).toBe(10000);
  });

  // ── ACH: payment_intent.processing (bank debit clearing) ──────────────────────
  function buildProcessingEvent(appointmentId: string) {
    return {
      id: `evt_pi_processing_${appointmentId}`,
      object: 'event',
      type: 'payment_intent.processing',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_test_${appointmentId}`,
          object: 'payment_intent',
          status: 'processing',
          metadata: { appointment_id: appointmentId },
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
  }

  it('payment_intent.processing marks the revenue row as processing (ACH clearing)', async () => {
    const admin = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100.81,
      status: 'pending',
      payment_method: 'ach',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const payload = JSON.stringify(buildProcessingEvent(appt.id));
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data } = await admin.from('payments').select('status').eq('appointment_id', appt.id);
    expect((data![0] as { status: string }).status).toBe('processing');
  });

  it('payment_intent.processing never regresses a row that already settled (paid)', async () => {
    const admin = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'ach',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const payload = JSON.stringify(buildProcessingEvent(appt.id));
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    const { data } = await admin.from('payments').select('status').eq('appointment_id', appt.id);
    expect((data![0] as { status: string }).status).toBe('paid');
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

  it('new-flow settlement with an un-onboarded cleaner pays the tenant and HOLDS the cleaner slice', async () => {
    const admin = createTestSupabaseClient();
    const tenantAcct = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    // Tenant (org) is Connect-ready; the assigned cleaner is NOT onboarded yet.
    await admin.from('organizations').update({ stripe_connect_account_id: tenantAcct }).eq('id', org.organizationId);
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: false })
      .eq('id', org.cleaner.userId);

    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_held_${appt.id}`,
    });

    const event = {
      id: `evt_held_${appt.id}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_held_${appt.id}`,
          object: 'payment_intent',
          status: 'succeeded',
          amount_received: 10000,
          latest_charge: `ch_held_${appt.id}`,
          on_behalf_of: tenantAcct, // new multi-tenant flow -> settleCleanerPayout
          metadata: { appointment_id: appt.id },
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

    // Tenant got ONLY their remainder ($40 = $100 gross - 60% cleaner cut); the $60 cleaner slice is
    // HELD, not transferred and not folded into the tenant payout.
    expect(vi.mocked(createPlatformTransfer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPlatformTransfer).mock.calls[0][0]).toMatchObject({
      destinationAccountId: tenantAcct,
      amountCents: 4000,
    });

    const { data: payouts } = await admin
      .from('payouts')
      .select('status, amount')
      .eq('appointment_id', appt.id);
    expect(payouts).toHaveLength(1);
    expect((payouts![0] as { status: string }).status).toBe('pending');
    expect(Number((payouts![0] as { amount: number }).amount)).toBe(60);
  });

  it('retry of a HELD slice pays the carved snapshot, not a recomputed split, if the percent was edited', async () => {
    const admin = createTestSupabaseClient();
    const tenantAcct = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    await admin.from('organizations').update({ stripe_connect_account_id: tenantAcct }).eq('id', org.organizationId);
    // Cleaner NOT onboarded at first settlement -> the $60 (60%) slice is held at that snapshot.
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: false })
      .eq('id', org.cleaner.userId);

    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_snap_${appt.id}`,
    });

    const event = {
      id: `evt_snap_${appt.id}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_snap_${appt.id}`,
          object: 'payment_intent',
          status: 'succeeded',
          amount_received: 10000,
          latest_charge: `ch_snap_${appt.id}`,
          on_behalf_of: tenantAcct,
          metadata: { appointment_id: appt.id },
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    };
    const payload = JSON.stringify(event);
    await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });

    const { data: held } = await admin.from('payouts').select('status, amount').eq('appointment_id', appt.id);
    expect((held![0] as { status: string }).status).toBe('pending');
    expect(Number((held![0] as { amount: number }).amount)).toBe(60);

    // Admin edits the cleaner's percent DOWN to 20% while they were still onboarding, then the
    // cleaner finishes onboarding. The reconcile retry must pay the carved $60 snapshot, NOT 20%
    // ($20) — the tenant was already paid the $40 remainder against the original 60% split.
    vi.mocked(createPlatformTransfer).mockClear();
    await admin
      .from('cleaner_profiles')
      .update({ payout_percent: 20, stripe_connect_onboarding_complete: true })
      .eq('id', org.cleaner.userId);

    const result = await settleCleanerPayout(admin, appt.id, null);
    expect(result.settled).toBe(true);

    // Exactly one transfer (cleaner leg; tenant already paid) for the SNAPSHOT $60, not the $20 recompute.
    expect(vi.mocked(createPlatformTransfer)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPlatformTransfer).mock.calls[0][0]).toMatchObject({
      destinationAccountId: 'acct_test_fake',
      amountCents: 6000,
    });

    const { data: paid } = await admin.from('payouts').select('status, amount').eq('appointment_id', appt.id);
    expect(paid).toHaveLength(1);
    expect((paid![0] as { status: string }).status).toBe('paid');
    expect(Number((paid![0] as { amount: number }).amount)).toBe(60);
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

  it('charge.dispute.created with no matching payment records an unmatched_dispute (not silently dropped)', async () => {
    const admin = createTestSupabaseClient();
    // A dispute whose PaymentIntent maps to no payment row (buildDisputeEvent uses pi_test_<id>).
    const orphanId = `orphan_${Date.now()}`;
    const payload = JSON.stringify(
      buildDisputeEvent({ type: 'charge.dispute.created', appointmentId: orphanId, status: 'needs_response', amountCents: 5000 }),
    );
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Recorded as a forensic event (auditable) instead of vanishing into a log line.
    const { data: events } = await admin
      .from('payment_events')
      .select('payload')
      .eq('event_type', 'unmatched_dispute');
    const found = (events ?? []).some(
      (e) => (e as { payload: { dispute_id?: string } }).payload?.dispute_id === `dp_${orphanId}`,
    );
    expect(found).toBe(true);

    // No disputes row was created (we couldn't map it to an org/payment).
    const { data: disputes } = await admin
      .from('disputes')
      .select('id')
      .eq('stripe_dispute_id', `dp_${orphanId}`);
    expect((disputes ?? []).length).toBe(0);
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

    // Full cleaner share reversed (platform-level reversal).
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_clawback', 6000, expect.any(String));

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

  it('payment_intent.payment_failed on a PAID row (late ACH return) claws back the cleaner, keeps the row paid', async () => {
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
      payment_method: 'ach',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_ach_${appt.id}`,
    });
    await admin.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'paid',
      stripe_transfer_id: 'tr_ach_clawback',
    });

    const event = {
      id: `evt_pif_${appt.id}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_ach_${appt.id}`,
          object: 'payment_intent',
          status: 'requires_payment_method',
          amount: 10000,
          metadata: { appointment_id: appt.id, organization_id: org.organizationId },
          last_payment_error: { message: 'debit_not_authorized' },
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

    // Auto-clawback: the cleaner payout is reversed.
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_ach_clawback', 6000, expect.any(String));
    const { data: payouts } = await admin.from('payouts').select('status').eq('appointment_id', appt.id);
    expect((payouts![0] as { status: string }).status).toBe('reversed');

    // The revenue row is NOT clobbered to 'failed' (money moved + settled); it stays 'paid' and a
    // late_payment_failure event is recorded for forensics.
    const { data: payment } = await admin
      .from('payments')
      .select('status')
      .eq('stripe_payment_intent_id', `pi_ach_${appt.id}`)
      .single();
    expect((payment as { status: string }).status).toBe('paid');

    const { data: events } = await admin
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'late_payment_failure');
    expect((events ?? []).length).toBe(1);
  });

  it('charge.refunded issued out-of-band claws back the cleaner + tenant transfers', async () => {
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
      stripe_payment_intent_id: `pi_oob_${appt.id}`,
    });
    await admin.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'paid',
      stripe_transfer_id: 'tr_oob_cleaner',
    });
    // The job's outbound transfers (cleaner + tenant) that an out-of-band refund must unwind.
    vi.mocked(listTransfersByGroup).mockResolvedValueOnce([
      { id: 'tr_oob_cleaner', amount: 6000, amount_reversed: 0 },
      { id: 'tr_oob_tenant', amount: 4000, amount_reversed: 0 },
    ] as never);

    const event = {
      id: `evt_oob_${appt.id}`,
      object: 'event',
      type: 'charge.refunded',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `ch_oob_${appt.id}`,
          object: 'charge',
          amount: 10000,
          amount_refunded: 10000,
          payment_intent: `pi_oob_${appt.id}`,
          refunds: { object: 'list', data: [] },
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

    // Both legs reversed proportionally (full refund → full reversal); cleaner payout marked reversed.
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_oob_cleaner', 6000, expect.any(String));
    expect(vi.mocked(reversePlatformTransfer)).toHaveBeenCalledWith('tr_oob_tenant', 4000, expect.any(String));
    const { data: payouts } = await admin.from('payouts').select('status').eq('appointment_id', appt.id);
    expect((payouts![0] as { status: string }).status).toBe('reversed');
  });

  it('payment_intent.canceled mirrors the canceled status onto the payments row (no re-auth)', async () => {
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
      payment_intent_status: 'processing',
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

    // With no holds, a canceled PI mirrors the status onto the payments row; the appointment's
    // authorization_status + reauth_count are left untouched (there is no re-authorization).
    const { data: a } = await admin
      .from('appointments')
      .select('authorization_status, reauth_count')
      .eq('id', appt.id)
      .single();
    expect((a as { authorization_status: string }).authorization_status).toBe('authorized');
    expect((a as { reauth_count: number }).reauth_count).toBe(0);

    // T3-13: the pending row TERMINALIZES (status 'failed'; the enum has no 'canceled') so
    // reconcileStuckPayments stops re-selecting it every sweep; payment_intent_status keeps
    // the canceled distinction for the audit trail.
    const { data: pay } = await admin
      .from('payments')
      .select('status, payment_intent_status')
      .eq('stripe_payment_intent_id', piId)
      .single();
    expect((pay as { payment_intent_status: string }).payment_intent_status).toBe('canceled');
    expect((pay as { status: string }).status).toBe('failed');

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

  it('payout.paid replay of an already-settled payout does NOT mis-stamp an unrelated payout (T1-10 idempotency)', async () => {
    const admin = createTestSupabaseClient();
    // Unique connect account for this cleaner so the handler's `.single()` lookup resolves
    // deterministically even on the shared local DB (many cleaners share 'acct_test_fake'), which
    // otherwise makes the cleaner lookup error out and mask the guard under test.
    const replayAcct = `acct_replay_${org.organizationId.slice(0, 8)}`;
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_account_id: replayAcct })
      .eq('id', org.cleaner.userId);
    const apptSettled = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const apptOther = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    // The first delivery already settled this payout's rows to bank_paid under po_replay_1.
    await admin.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: apptSettled.id,
      amount: 60,
      status: 'bank_paid',
      stripe_payout_id: 'po_replay_1',
      bank_paid_at: new Date().toISOString(),
    });
    // An UNRELATED, still-unsettled payout for the same cleaner. The oldest-unattributed fallback
    // would wrongly stamp THIS one on a naive replay; the idempotency guard must prevent that.
    const { data: otherRow } = await admin
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: apptOther.id,
        amount: 70,
        status: 'paid',
      })
      .select('id')
      .single();

    const eventId = `evt_payout_replay_${org.organizationId.slice(0, 8)}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'payout.paid',
      account: replayAcct,
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'po_replay_1', object: 'payout', amount: 6000, arrival_date: Math.floor(Date.now() / 1000) } },
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

    // The unrelated payout is left completely untouched (not mis-stamped with po_replay_1).
    const { data: otherAfter } = await admin
      .from('payouts')
      .select('status, stripe_payout_id')
      .eq('id', (otherRow as { id: string }).id)
      .single();
    expect((otherAfter as { status: string }).status).toBe('paid');
    expect((otherAfter as { stripe_payout_id: string | null }).stripe_payout_id).toBeNull();

    await admin.from('webhook_events').delete().eq('id', eventId);
  });

  it('payout.paid with RESOLVED transfer ids matching nothing does NOT stamp the oldest row (T3-15)', async () => {
    const admin = createTestSupabaseClient();
    const acct = `acct_t315_${org.organizationId.slice(0, 8)}`;
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_account_id: acct })
      .eq('id', org.cleaner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    // A still-owed 'paid' row whose transfer is NOT in this payout. The old fallback would have
    // stamped it anyway; a later payout.failed for this payout would then wrongly revert it.
    const { data: row } = await admin
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appt.id,
        amount: 60,
        status: 'paid',
        stripe_transfer_id: 'tr_mine_t315',
      })
      .select('id')
      .single();
    vi.mocked(getPayoutTransferIds).mockResolvedValueOnce(['tr_not_ours_t315']);

    const eventId = `evt_payout_t315_${org.organizationId.slice(0, 8)}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'payout.paid',
      account: acct,
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'po_t315', object: 'payout', amount: 6000, arrival_date: Math.floor(Date.now() / 1000) } },
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

    const { data: after } = await admin
      .from('payouts')
      .select('status, stripe_payout_id')
      .eq('id', (row as { id: string }).id)
      .single();
    expect((after as { status: string }).status).toBe('paid');
    expect((after as { stripe_payout_id: string | null }).stripe_payout_id).toBeNull();

    await admin.from('webhook_events').delete().eq('id', eventId);
  });

  it('payout.paid whose transfer resolution ERRORS stamps nothing (error is not knowledge)', async () => {
    const admin = createTestSupabaseClient();
    const acct = `acct_reserr_${org.organizationId.slice(0, 8)}`;
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_account_id: acct })
      .eq('id', org.cleaner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { data: row } = await admin
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appt.id,
        amount: 60,
        status: 'paid',
        stripe_transfer_id: 'tr_reserr_1',
      })
      .select('id')
      .single();
    // A transient Stripe failure must NOT route to the oldest-unattributed guess: the bank-paid
    // sweep multiplies executions of this path, so one 5xx per sweep would eventually mis-stamp.
    vi.mocked(getPayoutTransferIds).mockRejectedValueOnce(new Error('stripe 500'));

    const eventId = `evt_payout_reserr_${org.organizationId.slice(0, 8)}`;
    const event = {
      id: eventId,
      object: 'event',
      type: 'payout.paid',
      account: acct,
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'po_reserr', object: 'payout', amount: 6000, arrival_date: Math.floor(Date.now() / 1000) } },
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

    const { data: after } = await admin
      .from('payouts')
      .select('status, stripe_payout_id')
      .eq('id', (row as { id: string }).id)
      .single();
    expect((after as { status: string }).status).toBe('paid');
    expect((after as { stripe_payout_id: string | null }).stripe_payout_id).toBeNull();

    await admin.from('webhook_events').delete().eq('id', eventId);
  });

  it('transfer.reversed PARTIAL keeps the payout status; FULL terminalizes to reversed (T3-12)', async () => {
    const admin = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const transferId = `tr_t312_${appt.id.slice(0, 8)}`;
    const { data: row } = await admin
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appt.id,
        amount: 60,
        status: 'paid',
        stripe_transfer_id: transferId,
      })
      .select('id')
      .single();
    const rowId = (row as { id: string }).id;

    const sendReversal = async (suffix: string, amountReversed: number, reversed: boolean) => {
      const eventId = `evt_trrev_${suffix}_${appt.id.slice(0, 8)}`;
      const event = {
        id: eventId,
        object: 'event',
        type: 'transfer.reversed',
        api_version: '2025-12-15.clover',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: transferId,
            object: 'transfer',
            amount: 6000,
            amount_reversed: amountReversed,
            reversed,
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
      return eventId;
    };

    // Partial reversal (a partial-refund unwind): the payout must KEEP its status so a later
    // full clawback of the remaining cut is not silently blocked, and a forensic ledger row lands.
    const evt1 = await sendReversal('partial', 2000, false);
    const { data: afterPartial } = await admin
      .from('payouts')
      .select('status, reversed_at')
      .eq('id', rowId)
      .single();
    expect((afterPartial as { status: string }).status).toBe('paid');
    expect((afterPartial as { reversed_at: string | null }).reversed_at).not.toBeNull();
    const { data: ledger } = await admin
      .from('payment_events')
      .select('event_type, payload')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'transfer_partially_reversed');
    expect((ledger ?? []).length).toBe(1);
    expect(((ledger![0] as { payload: { amount_reversed: number } }).payload).amount_reversed).toBe(2000);

    // Full reversal terminalizes exactly as before.
    const evt2 = await sendReversal('full', 6000, true);
    const { data: afterFull } = await admin
      .from('payouts')
      .select('status')
      .eq('id', rowId)
      .single();
    expect((afterFull as { status: string }).status).toBe('reversed');

    await admin.from('webhook_events').delete().in('id', [evt1, evt2]);
  });

  it('payout.failed reverts bank_paid, writes the ledger event, and notifies cleaner + admins once (T3-14)', async () => {
    const admin = createTestSupabaseClient();
    const acct = `acct_t314_${org.organizationId.slice(0, 8)}`;
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_account_id: acct })
      .eq('id', org.cleaner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const payoutId = `po_t314_${org.organizationId.slice(0, 8)}`;
    const { data: row } = await admin
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appt.id,
        amount: 60,
        status: 'bank_paid',
        stripe_transfer_id: `tr_t314_${appt.id.slice(0, 8)}`,
        stripe_payout_id: payoutId,
        bank_paid_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    const sendFailure = async (suffix: string) => {
      const eventId = `evt_pofail_${suffix}_${org.organizationId.slice(0, 8)}`;
      const event = {
        id: eventId,
        object: 'event',
        type: 'payout.failed',
        account: acct,
        api_version: '2025-12-15.clover',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: payoutId,
            object: 'payout',
            amount: 6000,
            arrival_date: Math.floor(Date.now() / 1000),
            failure_code: 'account_closed',
            failure_message: 'The bank account has been closed.',
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
      return eventId;
    };

    const evt1 = await sendFailure('a');

    // The row reverts to 'paid' with the payout stamp cleared (pre-existing behavior).
    const { data: after } = await admin
      .from('payouts')
      .select('status, stripe_payout_id, bank_paid_at')
      .eq('id', (row as { id: string }).id)
      .single();
    expect((after as { status: string }).status).toBe('paid');
    expect((after as { stripe_payout_id: string | null }).stripe_payout_id).toBeNull();
    expect((after as { bank_paid_at: string | null }).bank_paid_at).toBeNull();

    // T3-14: no longer silent. Forensic ledger row + cleaner and admin notifications.
    const { data: ledger } = await admin
      .from('payment_events')
      .select('event_type, amount, payload')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cleaner_payout_bank_failed');
    expect((ledger ?? []).length).toBe(1);
    expect(((ledger![0] as { payload: { failure_code: string } }).payload).failure_code).toBe('account_closed');

    const notifQuery = () =>
      admin
        .from('notification_events')
        .select('recipient_user_id, payload')
        .eq('organization_id', org.organizationId)
        .eq('event_type', 'cleaner_payout_bank_failed');
    const { data: notifs } = await notifQuery();
    const cleanerRows = (notifs ?? []).filter(
      (n) => (n as { recipient_user_id: string }).recipient_user_id === org.cleaner.userId,
    );
    expect(cleanerRows.length).toBe(1);
    expect(((cleanerRows[0] as { payload: { audience: string } }).payload).audience).toBe('cleaner');
    // Fan-out reached at least one admin/owner recipient.
    expect((notifs ?? []).length).toBeGreaterThan(1);
    const countBefore = (notifs ?? []).length;

    // A re-delivery (new event id, same payout) reverts nothing and must not double-notify:
    // the notification is deduped by payout id.
    const evt2 = await sendFailure('b');
    const { data: notifsAfter } = await notifQuery();
    expect((notifsAfter ?? []).length).toBe(countBefore);

    await admin.from('webhook_events').delete().in('id', [evt1, evt2]);
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
