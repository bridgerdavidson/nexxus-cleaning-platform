import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// The card-ownership check hits Stripe (stubbed to throw by the global setup); mock the focused
// helper so the route logic runs against the real DB.
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  paymentMethodBelongsToCustomer: vi.fn(async () => true),
}));

import { POST } from './route';
import { paymentMethodBelongsToCustomer } from '@/lib/stripe/customers/homeowner';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  addManagerToOrg,
  type TestOrgFixture,
  type ManagerMemberHandle,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

describe('POST /api/appointments/:appointmentId/payment-method', () => {
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

  async function makeAppt() {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test_ho' })
      .eq('id', org.homeowner.userId);
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
    });
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { organization_id: org.organizationId, payment_method_id: 'pm_x' },
    });
    expect(status).toBe(401);
  });

  it('returns 404 when the new charge flow is disabled', async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, payment_method_id: 'pm_x' },
    });
    expect(status).toBe(404);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, payment_method_id: 'pm_x' },
    });
    expect(status).toBe(403);
  });

  it('400 when payment_method_id is missing', async () => {
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(400);
  });

  it('403 when the card does not belong to the homeowner', async () => {
    vi.mocked(paymentMethodBelongsToCustomer).mockResolvedValueOnce(false);
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, payment_method_id: 'pm_someone_else' },
    });
    expect(status).toBe(403);
  });

  it('admin sets the appointment payment method', async () => {
    const appt = await makeAppt();
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, payment_method_id: 'pm_test_card' },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('appointments')
      .select('payment_method_id')
      .eq('id', appt.id)
      .single();
    expect((data as { payment_method_id: string }).payment_method_id).toBe('pm_test_card');
  });

  it('changing the card on a FAILED appointment resets it to pending (Unpaid)', async () => {
    const appt = await makeAppt();
    const db = createTestSupabaseClient();
    // Simulate the prior declined authorization: failed appt + failed revenue payment row.
    await db
      .from('appointments')
      .update({ authorization_status: 'failed', reauth_count: 0 })
      .eq('id', appt.id);
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'failed',
      payment_type: 'revenue',
      payment_method: 'card',
      stripe_payment_intent_id: 'pi_declined',
    });

    const { status, body } = await callRoute<{ success: boolean; reset: boolean }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, payment_method_id: 'pm_new_card' },
    });
    expect(status).toBe(200);
    expect(body.reset).toBe(true);

    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status, reauth_count, payment_method_id')
      .eq('id', appt.id)
      .single();
    const a = apptRow as { authorization_status: string | null; reauth_count: number; payment_method_id: string };
    expect(a.authorization_status).toBeNull();
    expect(a.reauth_count).toBe(1);
    expect(a.payment_method_id).toBe('pm_new_card');

    // The pill is derived from payments.status — it must flip back to pending ("Unpaid").
    const { data: payRows } = await db
      .from('payments')
      .select('status, stripe_payment_intent_id')
      .eq('appointment_id', appt.id);
    const pay = payRows![0] as { status: string; stripe_payment_intent_id: string | null };
    expect(pay.status).toBe('pending');
    expect(pay.stripe_payment_intent_id).toBeNull();
  });

  it('the homeowner can set the card on their OWN appointment', async () => {
    const appt = await makeAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId, payment_method_id: 'pm_test_card' },
    });
    expect(status).toBe(200);
  });

  describe('manager gating (can_manage_payments)', () => {
    let mgr: ManagerMemberHandle;

    afterEach(async () => {
      await mgr?.cleanup();
    });

    it('rejects a manager WITHOUT can_manage_payments', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_manage_payments: false });
      const appt = await makeAppt();
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organization_id: org.organizationId, payment_method_id: 'pm_test_card' },
      });
      expect(status).toBe(403);
    });

    it('passes a manager WITH can_manage_payments', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_manage_payments: true });
      const appt = await makeAppt();
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organization_id: org.organizationId, payment_method_id: 'pm_test_card' },
      });
      expect(status).toBe(200);
    });

    it('does NOT block a homeowner setting their own card', async () => {
      const appt = await makeAppt();
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.homeowner.accessToken),
        body: { organization_id: org.organizationId, payment_method_id: 'pm_test_card' },
      });
      expect(status).not.toBe(403);
      expect(status).toBe(200);
    });
  });
});
