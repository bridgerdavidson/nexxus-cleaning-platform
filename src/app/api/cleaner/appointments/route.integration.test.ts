import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';

/**
 * GET /api/cleaner/appointments: the cleaner's price-free read path since
 * migration 122 removed their SELECT arm on appointments. The serialization
 * guards are the point of this file: no price, in any spelling, ever.
 */

describe('GET /api/cleaner/appointments', () => {
  let org: TestOrgFixture;
  let apptId: string;
  const admin = createTestSupabaseClient();

  const url = (orgId: string) =>
    `http://test.local/api/cleaner/appointments?organization_id=${orgId}`;

  beforeAll(async () => {
    org = await withTestOrg({ cleanerPayoutModel: 'request' });
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 137.53,
      status: 'confirmed',
    });
    apptId = appt.id;
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: apptId,
      amount: 137.53,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
    });
    // Out-of-order slots to prove server-side sorting.
    await admin.from('appointment_requested_slots').insert([
      { appointment_id: apptId, slot_index: 1, scheduled_date: '2026-08-05', scheduled_time: '13:00' },
      { appointment_id: apptId, slot_index: 0, scheduled_date: '2026-08-04', scheduled_time: '09:00' },
    ]);
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it('returns the cleaner appointment shape with embeds, statuses and sorted slots', async () => {
    const res = await callRoute<{ appointments: Record<string, unknown>[] }>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(res.status).toBe(200);
    expect(res.body.appointments).toHaveLength(1);
    const appt = res.body.appointments[0];
    expect(appt.id).toBe(apptId);
    expect(appt.payment_status).toBe('paid');
    expect((appt.homeowner as { first_name: string }).first_name).toBe('Homeowner');
    expect((appt.property as { address: string }).address).toBe('1 Test Lane');
    expect((appt.service_type as { duration_minutes: number }).duration_minutes).toBe(60);
    expect(
      (appt.requested_slots as { slot_index: number }[]).map((s) => s.slot_index),
    ).toEqual([0, 1]);
  });

  it('never serializes a price, in any spelling', async () => {
    const res = await callRoute(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('total_price');
    expect(raw).not.toContain('price_adder');
    expect(raw).not.toContain('base_price');
    expect(raw).not.toContain('137.53');
    expect(raw.toLowerCase()).not.toContain('amount');
  });

  it('rejects org staff (403): staff read appointments under their own RLS', async () => {
    const res = await callRoute(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a missing token (401) and a missing org id (400)', async () => {
    const noToken = await callRoute(GET, { method: 'GET', url: url(org.organizationId) });
    expect(noToken.status).toBe(401);
    const noOrg = await callRoute(GET, {
      method: 'GET',
      url: 'http://test.local/api/cleaner/appointments',
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(noOrg.status).toBe(400);
  });
});
