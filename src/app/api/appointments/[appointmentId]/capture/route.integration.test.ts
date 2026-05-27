import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/stripe/charges/capture', () => ({
  capturePaymentIntent: vi.fn(async () => ({ id: 'pi_test_cap', status: 'succeeded' })),
}));

import { POST } from './route';
import { capturePaymentIntent } from '@/lib/stripe/charges/capture';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

describe('POST /api/appointments/:appointmentId/capture', () => {
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

  async function makeAuthorizedAppt() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'in_progress',
    });
    await db.from('appointments').update({ authorization_status: 'authorized' }).eq('id', appt.id);
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_type: 'revenue',
      payment_method: 'card',
      stripe_payment_intent_id: 'pi_test_cap',
    });
    return appt;
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await makeAuthorizedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('allows the ASSIGNED cleaner to capture (capture-on-completion)', async () => {
    const appt = await makeAuthorizedAppt(); // assigned to org.cleaner
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('rejects a cleaner who is NOT the appointment\'s assigned cleaner', async () => {
    const appt = await makeAuthorizedAppt();
    const db = createTestSupabaseClient();
    // Unassign so the calling cleaner is no longer the assigned one — the guard must 403.
    await db.from('appointments').update({ cleaner_id: null }).eq('id', appt.id);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('409 when there is no authorization to capture', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
  });

  it('captures and marks the payment paid', async () => {
    const appt = await makeAuthorizedAppt();
    const { status, body } = await callRoute<{ success: boolean; payment_intent_id: string }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.payment_intent_id).toBe('pi_test_cap');

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('status, captured_at')
      .eq('appointment_id', appt.id);
    const pay = payRows![0] as { status: string; captured_at: string | null };
    expect(pay.status).toBe('paid');
    expect(pay.captured_at).not.toBeNull();

    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('captured');
  });

  it('is idempotent when the payment is already paid (no re-capture, stays paid)', async () => {
    const appt = await makeAuthorizedAppt();
    const db = createTestSupabaseClient();
    // Simulate a prior successful capture (e.g. the payment_intent.succeeded webhook won the race).
    await db.from('payments').update({ status: 'paid' }).eq('appointment_id', appt.id);
    // A second capture would throw "not capturable"; assert we never clobber the paid row.
    vi.mocked(capturePaymentIntent).mockRejectedValueOnce(new Error('intent not capturable'));

    const { status, body } = await callRoute<{ success: boolean; alreadyCaptured?: boolean }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const { data: paidRows } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', appt.id);
    expect((paidRows![0] as { status: string }).status).toBe('paid');
  });

  it('on capture failure: 502, payment marked failed, authorization_status=failed', async () => {
    const appt = await makeAuthorizedAppt();
    vi.mocked(capturePaymentIntent).mockRejectedValueOnce(new Error('card_declined'));

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(502);

    const db = createTestSupabaseClient();
    const { data: payRows } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', appt.id);
    expect((payRows![0] as { status: string }).status).toBe('failed');

    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('failed');
  });
});
