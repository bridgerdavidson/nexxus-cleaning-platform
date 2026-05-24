import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/stripe/charges/capture', () => ({
  capturePaymentIntent: vi.fn(async (pi: string) => ({ id: pi, status: 'succeeded' })),
}));
vi.mock('@/lib/stripe/charges/cancel', () => ({
  cancelAuthorization: vi.fn(async (pi: string) => ({ id: pi, status: 'canceled' })),
}));

import { POST } from './route';
import { capturePaymentIntent } from '@/lib/stripe/charges/capture';
import { cancelAuthorization } from '@/lib/stripe/charges/cancel';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

const today = () => new Date().toISOString().slice(0, 10);

describe('POST /api/appointments/:appointmentId/cancel', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  async function setPolicy(fields: { type: string; value: number; windowHours?: number }) {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        cancellation_fee_type: fields.type,
        cancellation_fee_value: fields.value,
        cancellation_window_hours: fields.windowHours ?? 24,
      })
      .eq('id', org.organizationId);
  }

  async function seedAppointment(opts: {
    scheduledDate?: string;
    scheduledTime?: string;
    withHold?: boolean;
  } = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'confirmed',
      scheduledDate: opts.scheduledDate ?? today(),
      scheduledTime: opts.scheduledTime ?? '12:00:00',
    });
    if (opts.withHold !== false) {
      await db.from('payments').insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: 'pending',
        payment_method: 'card',
        payment_type: 'revenue',
        stripe_payment_intent_id: `pi_${appt.id}`,
        payment_intent_status: 'requires_capture',
        authorized_at: new Date().toISOString(),
      });
    }
    return appt;
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await seedAppointment();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { organization_id: org.organizationId, party: 'homeowner' },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const appt = await seedAppointment();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner' },
    });
    expect(status).toBe(403);
  });

  it('404 for an appointment in another org (no existence leak)', async () => {
    const appt = await seedAppointment();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organization_id: org2.organizationId, party: 'homeowner' },
    });
    expect(status).toBe(404);
  });

  it('homeowner no-show: captures the flat fee and releases the rest', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(5000);
    expect(vi.mocked(capturePaymentIntent)).toHaveBeenCalledWith(`pi_${appt.id}`, 5000);
    expect(vi.mocked(cancelAuthorization)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db
      .from('appointments')
      .select('status, authorization_status, cancellation_fee_captured')
      .eq('id', appt.id)
      .single();
    const appointment = a as { status: string; authorization_status: string; cancellation_fee_captured: number };
    expect(appointment.status).toBe('cancelled');
    expect(appointment.authorization_status).toBe('captured');
    expect(Number(appointment.cancellation_fee_captured)).toBe(5000);

    const { data: p } = await db
      .from('payments')
      .select('status, amount')
      .eq('appointment_id', appt.id)
      .single();
    expect((p as { status: string }).status).toBe('paid');
    expect(Number((p as { amount: number }).amount)).toBe(50);
  });

  it('homeowner late-cancel inside window: captures a percent fee', async () => {
    await setPolicy({ type: 'percent', value: 20, windowHours: 24 });
    const appt = await seedAppointment({ scheduledDate: today(), scheduledTime: '12:00:00' });

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: false },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(2000); // 20% of $100
    expect(vi.mocked(capturePaymentIntent)).toHaveBeenCalledWith(`pi_${appt.id}`, 2000);
  });

  it('cleaner-caused cancel: releases the hold, charges nothing', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment();

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'cleaner', no_show: true },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(cancelAuthorization)).toHaveBeenCalledWith(`pi_${appt.id}`);
    expect(vi.mocked(capturePaymentIntent)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db
      .from('appointments')
      .select('status, authorization_status')
      .eq('id', appt.id)
      .single();
    expect((a as { status: string }).status).toBe('cancelled');
    expect((a as { authorization_status: string }).authorization_status).toBe('canceled');
  });

  it('on-time homeowner cancel (outside window): releases the hold, no fee', async () => {
    await setPolicy({ type: 'percent', value: 20, windowHours: 24 });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const appt = await seedAppointment({ scheduledDate: future, scheduledTime: '12:00:00' });

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: false },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(cancelAuthorization)).toHaveBeenCalledWith(`pi_${appt.id}`);
  });

  it('no live hold: cancels without charging, even if a fee would apply', async () => {
    await setPolicy({ type: 'flat', value: 50 });
    const appt = await seedAppointment({ withHold: false });

    const { status, body } = await callRoute<{ fee_captured_cents: number }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, party: 'homeowner', no_show: true },
    });
    expect(status).toBe(200);
    expect(body.fee_captured_cents).toBe(0);
    expect(vi.mocked(capturePaymentIntent)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: a } = await db.from('appointments').select('status').eq('id', appt.id).single();
    expect((a as { status: string }).status).toBe('cancelled');
  });
});
