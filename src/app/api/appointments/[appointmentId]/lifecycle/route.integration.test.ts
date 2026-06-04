import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
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

const admin = createTestSupabaseClient();

async function notificationsFor(appointmentId: string, eventType: string) {
  const { data } = await admin
    .from('notification_events')
    .select('recipient_user_id, event_type')
    .eq('appointment_id', appointmentId)
    .eq('event_type', eventType);
  return (data ?? []) as Array<{ recipient_user_id: string; event_type: string }>;
}

describe('POST /api/appointments/:appointmentId/lifecycle', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { organizationId: org.organizationId, event: 'started' },
    });
    expect(status).toBe(401);
  });

  it("returns 400 for an invalid event (after auth passes)", async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'bogus' },
    });
    expect(status).toBe(400);
  });

  it('returns 403 when a cleaner signals a job that is not theirs', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    // Reassign the appointment away from the calling cleaner.
    await admin.from('appointments').update({ cleaner_id: null }).eq('id', appt.id);

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'started' },
    });
    expect(status).toBe(403);
  });

  it('returns 403/404 for a cross-org caller', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organizationId: org2.organizationId, event: 'started' },
    });
    expect([403, 404]).toContain(status);
  });

  it('notifies the homeowner AND admins when the assigned cleaner starts the job', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'started' },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const rows = await notificationsFor(appt.id, 'job_started');
    const recipients = rows.map((r) => r.recipient_user_id);
    expect(recipients).toContain(org.homeowner.userId);
    expect(recipients).toContain(org.admin.userId);
  });

  it('notifies only admins for a self-pay appointment (no homeowner)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    // Convert to a self-pay (org-paid) appointment: no homeowner.
    await admin
      .from('appointments')
      .update({ is_self_pay: true, homeowner_id: null })
      .eq('id', appt.id);

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'completed' },
    });
    expect(status).toBe(200);

    const rows = await notificationsFor(appt.id, 'job_completed');
    const recipients = rows.map((r) => r.recipient_user_id);
    expect(recipients).toContain(org.admin.userId);
    expect(recipients).not.toContain(org.homeowner.userId);
  });
});
