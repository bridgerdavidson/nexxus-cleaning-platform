import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock the Stripe-touching authorize builder (its real impl calls getStripe(), stubbed
// to throw by the global integration setup). The orchestration (authorizeAppointment) +
// split math + ledger run for real against the local DB.
vi.mock('@/lib/stripe/charges/authorize', () => ({
  createDestinationAuthorization: vi.fn(async () => ({ id: 'pi_test_auth', status: 'requires_capture' })),
}));

// Self-pay path: authorizeSelfPayAppointment calls createSelfPayAuthorization (getStripe →
// throws under the global mock) and listSavedCards (also getStripe). Stub both per-file so the
// self-pay orchestration + gross-up math + ledger run for real against the DB.
vi.mock('@/lib/stripe/charges/authorizeSelfPay', () => ({
  createSelfPayAuthorization: vi.fn(async () => ({
    id: 'pi_selfpay_auth',
    status: 'requires_capture',
    latest_charge: 'ch_selfpay',
    amount: 0,
    metadata: { self_pay: 'true' },
  })),
}));
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  listSavedCards: vi.fn(async () => [
    { id: 'pm_company_card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true },
  ]),
  getPaymentMethodType: vi.fn(async () => 'card'),
}));

import { POST } from './route';
import { createDestinationAuthorization } from '@/lib/stripe/charges/authorize';
import { createSelfPayAuthorization } from '@/lib/stripe/charges/authorizeSelfPay';
import { listSavedCards, getPaymentMethodType } from '@/lib/stripe/customers/homeowner';
import { computeSelfPayAmounts } from '@/lib/payments/selfPayMath';
import { computeChargeBreakdown } from '@/lib/payments/processingFee';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

describe('POST /api/appointments/:appointmentId/authorize', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function makeAppt(opts: { withCard?: boolean } = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
    });
    if (opts.withCard) {
      await db.from('appointments').update({ payment_method_id: 'pm_test_card' }).eq('id', appt.id);
    }
    return appt;
  }

  async function makeTenantReady(): Promise<string> {
    const db = createTestSupabaseClient();
    // Unique per org — organizations.stripe_connect_account_id has a unique index, so a
    // shared constant collides with leaked test orgs across runs.
    const acctId = `acct_ready_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test_homeowner' })
      .eq('id', org.homeowner.userId);
    return acctId;
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('returns 404 when STRIPE_NEW_CHARGE_FLOW_ENABLED is false', async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(404);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('409 no_card when the appointment has no payment method', async () => {
    await makeTenantReady();
    const appt = await makeAppt({ withCard: false });
    const { status, body } = await callRoute<{ code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('no_card');
  });

  it('409 tenant_not_ready when the org has no charges-enabled connected account', async () => {
    // org has no stripe_connect_account_id by default
    const db = createTestSupabaseClient();
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_x' }).eq('id', org.homeowner.userId);
    const appt = await makeAppt({ withCard: true });
    const { status, body } = await callRoute<{ code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('tenant_not_ready');
  });

  it('authorizes successfully and writes a pending payment + ledger row', async () => {
    const acctId = await makeTenantReady();
    const appt = await makeAppt({ withCard: true });

    const { status, body } = await callRoute<{ success: boolean; code: string; payment_intent_id: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.code).toBe('authorized');
    expect(body.payment_intent_id).toBe('pi_test_auth');

    const db = createTestSupabaseClient();
    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('authorized');

    const { data: payRows } = await db
      .from('payments')
      .select('status, stripe_payment_intent_id, on_behalf_of_account_id, authorized_at')
      .eq('appointment_id', appt.id);
    expect(payRows).toHaveLength(1);
    const pay = payRows![0] as {
      status: string;
      stripe_payment_intent_id: string;
      on_behalf_of_account_id: string;
      authorized_at: string;
    };
    expect(pay.status).toBe('pending');
    expect(pay.stripe_payment_intent_id).toBe('pi_test_auth');
    expect(pay.on_behalf_of_account_id).toBe(acctId);
    expect(pay.authorized_at).not.toBeNull();

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    expect((events ?? []).some((e) => (e as { event_type: string }).event_type === 'authorized')).toBe(true);
  });

  it('on a declined card: 402, authorization_status=failed, and a FAILED payment row', async () => {
    await makeTenantReady();
    const appt = await makeAppt({ withCard: true });

    // Simulate Stripe declining the off_session confirm (the SDK throws, with the failed PI
    // attached to the error).
    const declineErr = Object.assign(new Error('Your card was declined.'), {
      payment_intent: { id: 'pi_test_declined', status: 'requires_payment_method' },
    });
    vi.mocked(createDestinationAuthorization).mockRejectedValueOnce(declineErr);

    const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(402);
    expect(body.success).toBe(false);
    expect(body.code).toBe('declined');

    const db = createTestSupabaseClient();
    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('failed');

    // The pill is derived from payments.status — a declined auth must leave a 'failed' row so the
    // admin sees "Failed", not a stale "Unpaid".
    const { data: payRows } = await db
      .from('payments')
      .select('status, stripe_payment_intent_id')
      .eq('appointment_id', appt.id);
    expect(payRows).toHaveLength(1);
    const pay = payRows![0] as { status: string; stripe_payment_intent_id: string | null };
    expect(pay.status).toBe('failed');
    expect(pay.stripe_payment_intent_id).toBe('pi_test_declined');

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    expect((events ?? []).some((e) => (e as { event_type: string }).event_type === 'authorize_failed')).toBe(true);
  });

  it('on requires_action (3-D Secure): 402 requires_action, and surfaces a counter + admin/homeowner notifications', async () => {
    await makeTenantReady();
    const appt = await makeAppt({ withCard: true });

    // The off_session confirm comes back needing customer authentication: NO live hold is placed.
    vi.mocked(createDestinationAuthorization).mockResolvedValueOnce({
      id: 'pi_requires_action',
      status: 'requires_action',
    } as never);

    const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(402);
    expect(body.success).toBe(false);
    expect(body.code).toBe('requires_action');

    const db = createTestSupabaseClient();
    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('requires_action');

    // Forensic counter so 3-D Secure frequency is measurable.
    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    expect(
      (events ?? []).some((e) => (e as { event_type: string }).event_type === 'authentication_required'),
    ).toBe(true);

    // Notifications: at least one admin row (fanned out) + a homeowner row, so it's never a silent
    // "placed hold" — it shows up under "Payments needing attention" and pings the homeowner.
    const { data: notifs } = await db
      .from('notification_events')
      .select('recipient_user_id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'authentication_required');
    expect((notifs ?? []).length).toBeGreaterThanOrEqual(2);
    expect(
      (notifs ?? []).some((n) => (n as { recipient_user_id: string }).recipient_user_id === org.homeowner.userId),
    ).toBe(true);
  });

  it('non-self-pay appointment: manager WITHOUT can_manage_payments still passes auth (legacy unaffected)', async () => {
    await makeTenantReady();
    const db = createTestSupabaseClient();
    // Normal (non-self-pay) appointment with a card.
    const appt = await makeAppt({ withCard: true });

    // Promote the homeowner user to manager but deny payments permission.
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: false,
    });

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    // The payments-permission gate ONLY applies to self-pay — regular managers must still pass.
    expect(status).not.toBe(403);
    expect(vi.mocked(createDestinationAuthorization)).toHaveBeenCalledTimes(1);
  });

  it('defers (no card hold) when the appointment PM is a bank account (ACH)', async () => {
    const prevAch = process.env.STRIPE_ACH_ENABLED;
    process.env.STRIPE_ACH_ENABLED = 'true';
    vi.mocked(getPaymentMethodType).mockResolvedValueOnce('us_bank_account');
    try {
      await makeTenantReady();
      const appt = await makeAppt({ withCard: true });
      const { status, body } = await callRoute<{ success: boolean; code: string }>(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(200);
      expect(body.code).toBe('deferred_ach');
      // No card-style manual-capture hold is attempted on the bank PM (the bug Codex flagged).
      expect(vi.mocked(createDestinationAuthorization)).not.toHaveBeenCalled();
      const db = createTestSupabaseClient();
      // No pending payment row — the debit happens at completion, not here.
      const { data: payRows } = await db.from('payments').select('id').eq('appointment_id', appt.id);
      expect(payRows ?? []).toHaveLength(0);
      // The appointment is not flipped to a failed authorization.
      const { data: a } = await db
        .from('appointments')
        .select('authorization_status')
        .eq('id', appt.id)
        .single();
      expect((a as { authorization_status: string | null }).authorization_status).not.toBe('failed');
    } finally {
      process.env.STRIPE_ACH_ENABLED = prevAch;
    }
  });
});

describe('POST /api/appointments/:appointmentId/authorize — self-pay', () => {
  let org: TestOrgFixture;
  let originalNewFlow: string | undefined;

  beforeEach(async () => {
    originalNewFlow = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    // Payout-capable cleaner: Connect onboarded, account present, payout% > 0.
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_selfpay_cleaner',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    vi.mocked(createSelfPayAuthorization).mockClear();
    vi.mocked(listSavedCards).mockClear();
    vi.mocked(createSelfPayAuthorization).mockResolvedValue({
      id: 'pi_selfpay_auth',
      status: 'requires_capture',
      latest_charge: 'ch_selfpay',
      amount: 0,
      metadata: { self_pay: 'true' },
    } as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalNewFlow;
    await org.cleanup();
  });

  /** A self-pay appointment on an org-owned property (no homeowner). */
  async function makeSelfPayAppt() {
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
      orgOwnedProperty: true,
      selfPay: true,
    });
  }

  async function giveOrgCard() {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_self_pay_customer_id: `cus_selfpay_${org.organizationId.slice(0, 12)}` })
      .eq('id', org.organizationId);
  }

  it('authorizes a self-pay appointment: 200, grossed-up charge, pending self-pay payment + ledger', async () => {
    await giveOrgCard();
    const appt = await makeSelfPayAppt();
    // $100 job, 60% → cleaner cut $60.00 (6000¢) grossed up for Stripe's 2.9%+30¢:
    // ceil((6000 + 30) / (1 - 0.029)) = ceil(6210.09) = 6211¢.
    const { chargeCents } = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 60 });
    expect(chargeCents).toBe(6211);

    const { status, body } = await callRoute<{ success: boolean; code: string; payment_intent_id: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.code).toBe('authorized');
    expect(body.payment_intent_id).toBe('pi_selfpay_auth');

    // createSelfPayAuthorization called with the grossed-up chargeCents (and the company card).
    expect(vi.mocked(createSelfPayAuthorization)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createSelfPayAuthorization).mock.calls[0][0];
    expect(arg.chargeCents).toBe(chargeCents);
    expect(arg.customerId).toBe(`cus_selfpay_${org.organizationId.slice(0, 12)}`);
    expect(arg.paymentMethodId).toBe('pm_company_card');

    const db = createTestSupabaseClient();
    const { data: a } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((a as { authorization_status: string }).authorization_status).toBe('authorized');

    // A single pending self-pay payment row for the grossed-up amount.
    const { data: payRows } = await db
      .from('payments')
      .select('status, is_self_pay, amount, stripe_payment_intent_id')
      .eq('appointment_id', appt.id);
    expect(payRows).toHaveLength(1);
    const pay = payRows![0] as { status: string; is_self_pay: boolean; amount: number; stripe_payment_intent_id: string };
    expect(pay.status).toBe('pending');
    expect(pay.is_self_pay).toBe(true);
    expect(Number(pay.amount)).toBe(chargeCents / 100);
    expect(pay.stripe_payment_intent_id).toBe('pi_selfpay_auth');

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    expect((events ?? []).some((e) => (e as { event_type: string }).event_type === 'authorized')).toBe(true);
  });

  it('409 no_org_card when the org has no company card on file (no Stripe auth attempted)', async () => {
    // org.stripe_self_pay_customer_id is null by default.
    const appt = await makeSelfPayAppt();
    const { status, body } = await callRoute<{ code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('no_org_card');
    expect(vi.mocked(createSelfPayAuthorization)).not.toHaveBeenCalled();
  });

  it('409 cleaner_not_payable when the assigned cleaner is not Connect-onboarded', async () => {
    await giveOrgCard();
    const db = createTestSupabaseClient();
    await db
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: false })
      .eq('id', org.cleaner.userId);
    const appt = await makeSelfPayAppt();

    const { status, body } = await callRoute<{ code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('cleaner_not_payable');
    expect(vi.mocked(createSelfPayAuthorization)).not.toHaveBeenCalled();
  });

  it('409 cleaner_not_payable when the assigned cleaner has payout_percent = 0', async () => {
    await giveOrgCard();
    const db = createTestSupabaseClient();
    await db.from('cleaner_profiles').update({ payout_percent: 0 }).eq('id', org.cleaner.userId);
    const appt = await makeSelfPayAppt();

    const { status, body } = await callRoute<{ code: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('cleaner_not_payable');
    expect(vi.mocked(createSelfPayAuthorization)).not.toHaveBeenCalled();
  });

  it('rejects a cleaner caller (403) even on a self-pay appointment', async () => {
    await giveOrgCard();
    const appt = await makeSelfPayAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(vi.mocked(createSelfPayAuthorization)).not.toHaveBeenCalled();
  });

  it('403 when a manager WITHOUT can_manage_payments tries to authorize a self-pay appointment', async () => {
    await giveOrgCard();
    const appt = await makeSelfPayAppt();
    const db = createTestSupabaseClient();
    // Promote the homeowner user to manager with no payments permission.
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: false,
    });

    const { status, body } = await callRoute<{ error: string }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(body.error).toBe('Requires the Manage Payments permission');
    expect(vi.mocked(createSelfPayAuthorization)).not.toHaveBeenCalled();
  });

  it('allows a manager WITH can_manage_payments to authorize a self-pay appointment (not 403)', async () => {
    await giveOrgCard();
    const appt = await makeSelfPayAppt();
    const db = createTestSupabaseClient();
    // Promote the homeowner user to manager and grant payments permission.
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: true,
    });

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    // 200 (authorized) — the auth gate passes, outcome from the mocked authorizer.
    expect(status).not.toBe(403);
    expect(vi.mocked(createSelfPayAuthorization)).toHaveBeenCalledTimes(1);
  });

});

describe('POST /api/appointments/:appointmentId/authorize — fee passthrough', () => {
  let org: TestOrgFixture;
  let originalNewFlow: string | undefined;
  let originalPassthrough: string | undefined;

  beforeEach(async () => {
    originalNewFlow = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    originalPassthrough = process.env.STRIPE_FEE_PASSTHROUGH_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
    vi.mocked(createDestinationAuthorization).mockClear();
    vi.mocked(createDestinationAuthorization).mockResolvedValue({
      id: 'pi_test_auth',
      status: 'requires_capture',
    } as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalNewFlow;
    process.env.STRIPE_FEE_PASSTHROUGH_ENABLED = originalPassthrough;
    await org.cleanup();
  });

  async function readyApptWithCard() {
    const db = createTestSupabaseClient();
    const acctId = `acct_ready_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test_homeowner' })
      .eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
    });
    await db.from('appointments').update({ payment_method_id: 'pm_test_card' }).eq('id', appt.id);
    return appt;
  }

  it('passthrough ON: charges the service price + card fee and snapshots processing_fee_cents', async () => {
    process.env.STRIPE_FEE_PASSTHROUGH_ENABLED = 'true';
    const appt = await readyApptWithCard();
    // $100 service -> card gross-up ceil((10000+30)/0.971) = 10330, fee 330.
    const { chargeCents, feeCents } = computeChargeBreakdown('card', 10000);
    expect(chargeCents).toBe(10330);
    expect(feeCents).toBe(330);

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);

    // The homeowner is charged the grossed-up amount (service price + fee).
    expect(vi.mocked(createDestinationAuthorization)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createDestinationAuthorization).mock.calls[0][0].grossCents).toBe(chargeCents);

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('amount, processing_fee_cents')
      .eq('appointment_id', appt.id);
    const pay = payRows![0] as { amount: number; processing_fee_cents: number };
    expect(Number(pay.amount)).toBe(chargeCents / 100);
    expect(Number(pay.processing_fee_cents)).toBe(feeCents);
  });

  it('passthrough OFF: charges the bare service price, processing_fee_cents stays null', async () => {
    process.env.STRIPE_FEE_PASSTHROUGH_ENABLED = 'false';
    const appt = await readyApptWithCard();

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);

    expect(vi.mocked(createDestinationAuthorization).mock.calls[0][0].grossCents).toBe(10000);

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('amount, processing_fee_cents')
      .eq('appointment_id', appt.id);
    const pay = payRows![0] as { amount: number; processing_fee_cents: number | null };
    expect(Number(pay.amount)).toBe(100);
    expect(pay.processing_fee_cents).toBeNull();
  });
});
