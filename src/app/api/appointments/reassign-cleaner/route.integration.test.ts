import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  createAuthUser,
  addManagerToOrg,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/** withTestOrg seeds one cleaner; a reassign needs a second cleaner in the same org. */
async function addCleanerToOrg(organizationId: string) {
  const db = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);
  const email = `cleaner2-${uniq}@test.local`;
  const c = await createAuthUser(email, 'cleaner', 'CleanerTwo');
  await db
    .from('user_profiles')
    .upsert(
      { id: c.id, email, first_name: 'Clea', last_name: 'Two', role: 'cleaner' },
      { onConflict: 'id' },
    );
  await db
    .from('organization_members')
    .insert({ user_id: c.id, organization_id: organizationId, role: 'cleaner' });
  await db.from('cleaner_profiles').insert({
    id: c.id,
    organization_id: organizationId,
    payout_percent: 60,
    stripe_connect_onboarding_complete: false,
  });
  return { userId: c.id, accessToken: c.accessToken, cleanup: () => db.auth.admin.deleteUser(c.id) };
}

describe('POST /api/appointments/reassign-cleaner', () => {
  let org: TestOrgFixture;
  let cleanerB: Awaited<ReturnType<typeof addCleanerToOrg>>;

  beforeEach(async () => {
    org = await withTestOrg();
    cleanerB = await addCleanerToOrg(org.organizationId);
  });

  afterEach(async () => {
    await cleanerB.cleanup();
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: {
        appointmentId: randomUUID(),
        cleanerId: cleanerB.userId,
        organizationId: org.organizationId,
      },
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

  it('rejects a cleaner that is not in the org (400)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId: appt.id,
        cleanerId: randomUUID(),
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(400);
  });

  it('rejects a manager without reassign permission (403)', async () => {
    const manager = await addManagerToOrg(org.organizationId, {});
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(manager.accessToken),
      body: {
        appointmentId: appt.id,
        cleanerId: cleanerB.userId,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(403);
    await manager.cleanup();
  });

  it('reassigns to a new cleaner: pending + awaiting + deadline + notification', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      scheduledDate: '2026-07-01',
      scheduledTime: '10:00',
    });

    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId: appt.id,
        cleanerId: cleanerB.userId,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('appointments')
      .select('cleaner_id, status, cleaner_confirmation_status, response_deadline')
      .eq('id', appt.id)
      .single();
    expect(row?.cleaner_id).toBe(cleanerB.userId);
    expect(row?.status).toBe('pending');
    expect(row?.cleaner_confirmation_status).toBe('awaiting');
    expect(row?.response_deadline).toBeTruthy();

    const { data: notes } = await db
      .from('notification_events')
      .select('event_type, recipient_user_id')
      .eq('appointment_id', appt.id);
    expect(
      (notes ?? []).some(
        (n) => n.event_type === 'cleaner_assigned' && n.recipient_user_id === cleanerB.userId,
      ),
    ).toBe(true);
  });

  it('blocks a conflicting reassign without force (409), allows it with force (200)', async () => {
    // cleaner B already has a 10:00-11:00 job that day.
    await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: cleanerB.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      scheduledDate: '2026-07-02',
      scheduledTime: '10:00',
    });
    // The appointment to reassign overlaps at 10:30.
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      scheduledDate: '2026-07-02',
      scheduledTime: '10:30',
    });

    const blocked = await callRoute<{ conflict?: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId: appt.id,
        cleanerId: cleanerB.userId,
        organizationId: org.organizationId,
      },
    });
    expect(blocked.status).toBe(409);

    const forced = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId: appt.id,
        cleanerId: cleanerB.userId,
        organizationId: org.organizationId,
        force: true,
      },
    });
    expect(forced.status).toBe(200);

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('appointments')
      .select('cleaner_id')
      .eq('id', appt.id)
      .single();
    expect(row?.cleaner_id).toBe(cleanerB.userId);
  });
});
