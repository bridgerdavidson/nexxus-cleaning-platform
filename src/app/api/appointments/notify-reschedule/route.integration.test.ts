import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/appointments/notify-reschedule', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { appointmentId: randomUUID(), organizationId: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId },
    });
    expect(status).toBe(400);
  });

  it('returns 404 for an appointment not in the org', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { appointmentId: randomUUID(), organizationId: org.organizationId },
    });
    expect(status).toBe(404);
  });

  it('notifies the assigned cleaner that their job was rescheduled', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'pending',
      scheduledDate: '2026-08-01',
      scheduledTime: '09:00',
    });

    const { status, body } = await callRoute<{ success: boolean; notified: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { appointmentId: appt.id, organizationId: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.notified).toBe(true);

    const db = createTestSupabaseClient();
    const { data: notes } = await db
      .from('notification_events')
      .select('event_type, recipient_user_id')
      .eq('appointment_id', appt.id);
    expect(
      (notes ?? []).some(
        (n) =>
          n.event_type === 'appointment_rescheduled' &&
          n.recipient_user_id === org.cleaner.userId,
      ),
    ).toBe(true);
  });

  it('is a no-op (notified:false) when the appointment has no cleaner', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const db = createTestSupabaseClient();
    await db.from('appointments').update({ cleaner_id: null }).eq('id', appt.id);

    const { status, body } = await callRoute<{ success: boolean; notified: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { appointmentId: appt.id, organizationId: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.notified).toBe(false);
  });
});
