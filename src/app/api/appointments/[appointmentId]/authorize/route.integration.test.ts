import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock the Stripe-touching authorize builder (its real impl calls getStripe(), stubbed
// to throw by the global integration setup). The orchestration (authorizeAppointment) +
// split math + ledger run for real against the local DB.
vi.mock('@/lib/stripe/charges/authorize', () => ({
  createDestinationAuthorization: vi.fn(async () => ({ id: 'pi_test_auth', status: 'requires_capture' })),
}));

import { POST } from './route';
import { createDestinationAuthorization } from '@/lib/stripe/charges/authorize';
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
});
