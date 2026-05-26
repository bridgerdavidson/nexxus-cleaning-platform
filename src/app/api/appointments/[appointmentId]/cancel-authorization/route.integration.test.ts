import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/stripe/charges/cancel', () => ({
  cancelAuthorization: vi.fn(async () => ({ id: 'pi_test_cancel', status: 'canceled' })),
}));

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

describe('POST /api/appointments/:appointmentId/cancel-authorization', () => {
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
      status: 'confirmed',
    });
    await db.from('appointments').update({ authorization_status: 'authorized' }).eq('id', appt.id);
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'pending',
      payment_type: 'revenue',
      payment_method: 'card',
      stripe_payment_intent_id: 'pi_test_cancel',
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

  it('rejects a cleaner (insufficient role)', async () => {
    const appt = await makeAuthorizedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('409 when there is no authorization to cancel', async () => {
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

  it('cancels the hold and marks the appointment + payment canceled', async () => {
    const appt = await makeAuthorizedAppt();
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: apptRow } = await db
      .from('appointments')
      .select('authorization_status')
      .eq('id', appt.id)
      .single();
    expect((apptRow as { authorization_status: string }).authorization_status).toBe('canceled');

    const { data: payRows } = await db
      .from('payments')
      .select('payment_intent_status')
      .eq('appointment_id', appt.id);
    expect((payRows![0] as { payment_intent_status: string }).payment_intent_status).toBe('canceled');
  });
});
