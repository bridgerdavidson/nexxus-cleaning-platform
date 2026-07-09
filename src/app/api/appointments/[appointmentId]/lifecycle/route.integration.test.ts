import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
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

  it('stamps started_at when the job starts', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'started' },
    });
    expect(status).toBe(200);

    const { data: row } = await admin
      .from('appointments')
      .select('started_at')
      .eq('id', appt.id)
      .single();
    expect(row?.started_at).not.toBeNull();
  });

  it('stamps completed_at when the job completes', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'completed' },
    });
    expect(status).toBe(200);

    const { data: row } = await admin
      .from('appointments')
      .select('completed_at')
      .eq('id', appt.id)
      .single();
    expect(row?.completed_at).not.toBeNull();
  });

  it('does not move started_at on a second started call (idempotency guard)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    // First call — stamps started_at.
    await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'started' },
    });

    const { data: first } = await admin
      .from('appointments')
      .select('started_at')
      .eq('id', appt.id)
      .single();
    const firstStampedAt = first?.started_at;
    expect(firstStampedAt).not.toBeNull();

    // Second call — the .is('started_at', null) guard means the UPDATE
    // matches zero rows; started_at must remain unchanged.
    await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, event: 'started' },
    });

    const { data: second } = await admin
      .from('appointments')
      .select('started_at')
      .eq('id', appt.id)
      .single();
    expect(second?.started_at).toBe(firstStampedAt);
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

  // ── Manager permission gating (Task 5) ────────────────────────────────────────
  // requireManagerPermission preserves the existing allowedRoles (cleaner/admin/owner/
  // manager) and only gates the 'manager' branch on can_edit_bookings; the cleaner
  // ownership branch above is untouched.

  describe('manager permission gating', () => {
    let mgr: ManagerMemberHandle;

    afterEach(async () => {
      if (mgr) await mgr.cleanup();
    });

    it('403s for a manager without can_edit_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
      const appt = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
      });
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organizationId: org.organizationId, event: 'started' },
      });
      expect(status).toBe(403);
    });

    it('passes auth for a manager WITH can_edit_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
      const appt = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
      });
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organizationId: org.organizationId, event: 'started' },
      });
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
      expect(status).toBe(200);
    });

    it('does NOT block the assigned cleaner (they use their own branch)', async () => {
      const appt = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
      });
      const { status } = await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.cleaner.accessToken),
        body: { organizationId: org.organizationId, event: 'started' },
      });
      expect(status).not.toBe(403);
      expect(status).toBe(200);
    });
  });
});
