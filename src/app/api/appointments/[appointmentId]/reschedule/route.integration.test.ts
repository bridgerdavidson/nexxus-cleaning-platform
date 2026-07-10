import { describe, it, expect, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg, createTestAppointment, addManagerToOrg,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const admin = createTestSupabaseClient();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function seedOrg(opts: Parameters<typeof withTestOrg>[0] = {}) {
  const org = await withTestOrg(opts);
  cleanups.push(() => org.cleanup());
  return org;
}

function call(appointmentId: string, token: string, body: Record<string, unknown>) {
  return callRoute<Record<string, unknown>>((req) => POST(req, { params: Promise.resolve({ appointmentId }) }), {
    method: 'POST',
    body,
    headers: bearerHeader(token),
  });
}

async function seedFeedback(appointmentId: string, cleanerId: string, opts: { time?: { date: string; time: string }; window?: { date: string; start: string; end: string } }) {
  const { data: fb } = await admin
    .from('cleaner_availability_feedback')
    .insert({ appointment_id: appointmentId, cleaner_id: cleanerId, reason: null })
    .select('id').single();
  const feedbackId = (fb as { id: string }).id;
  if (opts.time) {
    await admin.from('cleaner_suggested_times').insert({ feedback_id: feedbackId, suggested_date: opts.time.date, suggested_time: opts.time.time });
  }
  if (opts.window) {
    await admin.from('cleaner_suggested_windows').insert({ feedback_id: feedbackId, window_date: opts.window.date, start_time: opts.window.start, end_time: opts.window.end });
  }
  return feedbackId;
}

async function getAppt(id: string) {
  const { data } = await admin.from('appointments')
    .select('status, cleaner_confirmation_status, cleaner_id, scheduled_date, scheduled_time, response_deadline, request_state')
    .eq('id', id).single();
  return data as Record<string, unknown>;
}

async function eventsFor(id: string) {
  const { data } = await admin.from('notification_events')
    .select('event_type, recipient_user_id, payload').eq('appointment_id', id);
  return (data ?? []) as Array<{ event_type: string; recipient_user_id: string; payload: Record<string, unknown> }>;
}

describe('POST /api/appointments/[appointmentId]/reschedule', () => {
  it('re-asks the cleaner on a plain time change (deadline, notification, cleanup)', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'confirmed' });
    await admin.from('appointments').update({ cleaner_confirmation_status: 'approved' }).eq('id', appt.id);
    await seedFeedback(appt.id, org.cleaner.userId, { time: { date: '2026-06-08', time: '11:00' } });
    await admin.from('appointment_requested_slots').insert([
      { appointment_id: appt.id, slot_index: 0, scheduled_date: '2026-06-01', scheduled_time: '10:00' },
      { appointment_id: appt.id, slot_index: 1, scheduled_date: '2026-06-02', scheduled_time: '10:00' },
    ]);
    await admin.from('appointment_routing_log').insert({ appointment_id: appt.id, cleaner_id: org.cleaner.userId, attempt_index: 1, deadline_at: new Date().toISOString() });

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, outcome: 'awaiting' });

    const row = await getAppt(appt.id);
    expect(row).toMatchObject({ status: 'pending', cleaner_confirmation_status: 'awaiting', scheduled_date: '2026-06-10', scheduled_time: '14:00:00' });
    expect(row.response_deadline).toBeTruthy();

    const { data: fb } = await admin.from('cleaner_availability_feedback').select('id').eq('appointment_id', appt.id);
    expect(fb).toHaveLength(0);
    const { data: slots } = await admin.from('appointment_requested_slots').select('slot_index').eq('appointment_id', appt.id);
    expect(slots).toHaveLength(0);
    const { data: log } = await admin.from('appointment_routing_log').select('response').eq('appointment_id', appt.id);
    expect((log ?? []).every((r) => (r as { response: string }).response === 'expired')).toBe(true);

    const events = await eventsFor(appt.id);
    const resched = events.filter((e) => e.event_type === 'appointment_rescheduled');
    expect(resched).toHaveLength(1);
    expect(resched[0].recipient_user_id).toBe(org.cleaner.userId);
    expect(resched[0].payload.requires_confirmation).toBe(true);
    expect(events.some((e) => e.event_type === 'appointment_time_changed')).toBe(false);
  });

  it('auto-approves a pick matching the current cleaner suggestion and notifies homeowner', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'pending' });
    await admin.from('appointments').update({ cleaner_confirmation_status: 'rejected' }).eq('id', appt.id);
    await seedFeedback(appt.id, org.cleaner.userId, { time: { date: '2026-06-08', time: '11:00' } });

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-08', scheduledTime: '11:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(appt.id)).toMatchObject({
      status: 'confirmed', cleaner_confirmation_status: 'approved', response_deadline: null, scheduled_time: '11:00:00',
    });
    const events = await eventsFor(appt.id);
    expect(events.some((e) => e.event_type === 'cleaner_counter_accepted' && e.recipient_user_id === org.cleaner.userId)).toBe(true);
    expect(events.some((e) => e.event_type === 'appointment_time_changed' && e.recipient_user_id === org.homeowner.userId)).toBe(true);
  });

  it('does NOT auto-approve on another cleaner\'s suggestion', async () => {
    const org = await seedOrg();
    const other = await addManagerToOrg(org.organizationId); // any second user works as feedback owner
    cleanups.push(() => other.cleanup());
    // cleaner_availability_feedback.cleaner_id FKs to cleaner_profiles(id); give the
    // "other" user a cleaner_profiles row so the FK is satisfied (mirrors the
    // second-cleaner setup in the "cleaner change" test below).
    await admin.from('cleaner_profiles').insert({ id: other.userId, organization_id: org.organizationId, is_available: true });
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'pending' });
    await seedFeedback(appt.id, other.userId, { time: { date: '2026-06-08', time: '11:00' } });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-08', scheduledTime: '11:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'awaiting' });
  });

  it('settles for employee-model orgs and notifies homeowner + cleaner FYI', async () => {
    const org = await seedOrg({ defaultPayoutModel: 'hourly_external' });
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'confirmed' });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-12', scheduledTime: '09:00', cleanerId: org.cleaner.userId,
    });
    expect(res.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(appt.id)).toMatchObject({ status: 'confirmed', cleaner_confirmation_status: 'approved', response_deadline: null });
    const events = await eventsFor(appt.id);
    const fyi = events.find((e) => e.event_type === 'appointment_rescheduled');
    expect(fyi?.payload.requires_confirmation).toBe(false);
    expect(events.some((e) => e.event_type === 'appointment_time_changed')).toBe(true);
  });

  it('employee-settled + cleaner change fires cleaner_force_assigned', async () => {
    const org = await seedOrg({ defaultPayoutModel: 'hourly_external' });
    // Second cleaner (B) in the same org: any org member with a cleaner_profiles row.
    const b = await addManagerToOrg(org.organizationId);
    cleanups.push(() => b.cleanup());
    await admin.from('cleaner_profiles').insert({ id: b.userId, organization_id: org.organizationId, is_available: true });

    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'confirmed' });

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-12', scheduledTime: '09:00', cleanerId: b.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(appt.id)).toMatchObject({ cleaner_id: b.userId, status: 'confirmed' });

    const events = await eventsFor(appt.id);
    expect(events.some((e) => e.event_type === 'cleaner_force_assigned' && e.recipient_user_id === b.userId)).toBe(true);
    expect(events.some((e) => e.event_type === 'appointment_time_changed' && e.recipient_user_id === org.homeowner.userId)).toBe(true);
  });

  it('cleans up sibling state (feedback, slots, pending routing rows) on a SETTLED outcome', async () => {
    const org = await seedOrg({ defaultPayoutModel: 'hourly_external' });
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'confirmed' });
    await seedFeedback(appt.id, org.cleaner.userId, { time: { date: '2026-06-08', time: '11:00' } });
    await admin.from('appointment_requested_slots').insert([
      { appointment_id: appt.id, slot_index: 0, scheduled_date: '2026-06-01', scheduled_time: '10:00' },
    ]);
    await admin.from('appointment_routing_log').insert({ appointment_id: appt.id, cleaner_id: org.cleaner.userId, attempt_index: 1, deadline_at: new Date().toISOString() });

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-12', scheduledTime: '09:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'settled' });

    const { data: fb } = await admin.from('cleaner_availability_feedback').select('id').eq('appointment_id', appt.id);
    expect(fb).toHaveLength(0);
    const { data: slots } = await admin.from('appointment_requested_slots').select('slot_index').eq('appointment_id', appt.id);
    expect(slots).toHaveLength(0);
    const { data: log } = await admin.from('appointment_routing_log').select('response, responded_at').eq('appointment_id', appt.id);
    expect(log).toHaveLength(1);
    expect((log ?? [])[0]).toMatchObject({ response: 'expired' });
    expect(((log ?? [])[0] as { responded_at: string | null }).responded_at).not.toBeNull();
  });

  it('cleaner change requires can_handle_requests and emits cleaner_assigned', async () => {
    const org = await seedOrg();
    const editOnly = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    cleanups.push(() => editOnly.cleanup());
    const both = await addManagerToOrg(org.organizationId, { can_edit_bookings: true, can_handle_requests: true });
    cleanups.push(() => both.cleanup());
    const org2 = await seedOrg(); // unused cleaner source is org's own second cleaner below
    // second cleaner in the same org:
    const cleaner2 = org2.cleaner; // wrong org on purpose for the org-check test later
    const { data: c2 } = await admin.from('cleaner_profiles').select('id').eq('id', org.cleaner.userId).single();
    expect(c2).toBeTruthy();

    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'pending' });

    // Need a second cleaner in-org: promote the homeowner is invalid; create via second appointment fixture is heavy.
    // Simplest: another org member with a cleaner_profiles row.
    const { data: cp } = await admin.from('cleaner_profiles')
      .insert({ id: editOnly.userId, organization_id: org.organizationId, is_available: true })
      .select('id').single();
    const newCleanerId = (cp as { id: string }).id;

    const denied = await call(appt.id, editOnly.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: newCleanerId,
    });
    expect(denied.status).toBe(403);

    const ok = await call(appt.id, both.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: newCleanerId,
    });
    expect(ok.status).toBe(200);
    const events = await eventsFor(appt.id);
    expect(events.some((e) => e.event_type === 'cleaner_assigned' && e.recipient_user_id === newCleanerId)).toBe(true);

    // wrong-org cleaner rejected
    const bad = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '15:00', cleanerId: cleaner2.userId,
    });
    expect(bad.status).toBe(400);
  });

  it('manager without can_edit_bookings is rejected', async () => {
    const org = await seedOrg();
    const none = await addManagerToOrg(org.organizationId, { can_handle_requests: true });
    cleanups.push(() => none.cleanup());
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const res = await call(appt.id, none.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(403);
  });

  it('409 conflict with details unless force', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, scheduledDate: '2026-06-01', scheduledTime: '10:00' });
    const blocker = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, scheduledDate: '2026-06-10', scheduledTime: '14:00' });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:30', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ conflict: true });
    expect((res.body as { details: { appointmentId: string } }).details.appointmentId).toBe(blocker.id);

    const forced = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:30', cleanerId: org.cleaner.userId, force: true,
    });
    expect(forced.status).toBe(200);
  });

  it('409 stale when the booking is no longer pending/confirmed', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId, status: 'cancelled' });
    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ stale: true });
  });

  it('cannot unassign; unassigned stays unassigned + homeowner notified', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const bad = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: null,
    });
    expect(bad.status).toBe(400);

    const un = await createTestAppointment({ organizationId: org.organizationId, cleanerId: null, homeownerId: org.homeowner.userId });
    const res = await call(un.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-11', scheduledTime: '09:00', cleanerId: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(un.id)).toMatchObject({ status: 'pending', cleaner_id: null, scheduled_date: '2026-06-11' });
    const events = await eventsFor(un.id);
    expect(events.some((e) => e.event_type === 'appointment_time_changed')).toBe(true);
  });

  it('homeowner_request: re-ask sets request_state routing + inserts a routing row; settled sets completed', async () => {
    const org = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: null, homeownerId: org.homeowner.userId });
    await admin.from('appointments').update({ flow_type: 'homeowner_request', homeowner_initiated: true, request_state: 'awaiting_admin' }).eq('id', appt.id);

    const res = await call(appt.id, org.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'awaiting' });
    expect(await getAppt(appt.id)).toMatchObject({ request_state: 'routing', cleaner_confirmation_status: 'awaiting' });
    const { data: log } = await admin.from('appointment_routing_log').select('response, cleaner_id').eq('appointment_id', appt.id);
    expect((log ?? []).some((r) => (r as { response: string | null }).response === null || (r as { response: string }).response === 'pending')).toBe(true);

    // settled variant on an employee org
    const org2 = await seedOrg({ defaultPayoutModel: 'hourly_external' });
    const appt2 = await createTestAppointment({ organizationId: org2.organizationId, cleanerId: org2.cleaner.userId, homeownerId: org2.homeowner.userId });
    await admin.from('appointments').update({ flow_type: 'homeowner_request', homeowner_initiated: true, request_state: 'awaiting_admin' }).eq('id', appt2.id);
    const res2 = await call(appt2.id, org2.admin.accessToken, {
      organizationId: org2.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org2.cleaner.userId,
    });
    expect(res2.body).toMatchObject({ outcome: 'settled' });
    expect(await getAppt(appt2.id)).toMatchObject({ request_state: 'completed' });
  });

  it('cross-org caller gets 403/404', async () => {
    const org = await seedOrg();
    const org2 = await seedOrg();
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.userId, homeownerId: org.homeowner.userId });
    const res = await call(appt.id, org2.admin.accessToken, {
      organizationId: org.organizationId, scheduledDate: '2026-06-10', scheduledTime: '14:00', cleanerId: org.cleaner.userId,
    });
    expect([403, 404]).toContain(res.status);
  });
});
