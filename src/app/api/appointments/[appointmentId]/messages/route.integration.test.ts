// src/app/api/appointments/[appointmentId]/messages/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient, createUserClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

const admin = createTestSupabaseClient();

async function jobMessageNotifs(appointmentId: string) {
  const { data } = await admin
    .from('notification_events')
    .select('recipient_user_id, event_type')
    .eq('appointment_id', appointmentId)
    .eq('event_type', 'job_message');
  return (data ?? []) as Array<{ recipient_user_id: string; event_type: string }>;
}

describe('POST /api/appointments/:appointmentId/messages (job messaging)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });
  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  async function confirmedAppt() {
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
    });
  }

  it('401 with no Authorization header', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { content: 'hi' },
    });
    expect(status).toBe(401);
  });

  it('404 for an unknown appointment', async () => {
    const { status } = await callRoute(handlerFor('00000000-0000-0000-0000-000000000000'), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'hi' },
    });
    expect(status).toBe(404);
  });

  it('403 for a non-participant caller', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org2.homeowner.accessToken),
      body: { content: 'let me in' },
    });
    expect(status).toBe(403);
  });

  it('201 homeowner -> cleaner: creates the appointment-scoped conversation, inserts the message, notifies the cleaner', async () => {
    const appt = await confirmedAppt();
    const { status, body } = await callRoute<{ message: { conversation_id: string } }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.homeowner.accessToken),
        body: { content: 'Gate code is 1234' },
      },
    );
    expect(status).toBe(201);

    const { data: convs } = await admin
      .from('conversations')
      .select('id, appointment_id')
      .eq('appointment_id', appt.id);
    expect(convs).toHaveLength(1);
    expect(body.message.conversation_id).toBe(convs![0].id);

    const { data: msgs } = await admin
      .from('messages')
      .select('sender_id, recipient_id, appointment_id, content')
      .eq('appointment_id', appt.id);
    expect(msgs).toHaveLength(1);
    expect(msgs![0].recipient_id).toBe(org.cleaner.userId);
    expect(msgs![0].sender_id).toBe(org.homeowner.userId);

    const recipients = (await jobMessageNotifs(appt.id)).map((n) => n.recipient_user_id);
    expect(recipients).toEqual([org.cleaner.userId]);
  });

  it('201 cleaner -> homeowner: notifies the homeowner', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'in_progress',
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { content: 'Running 10 min late' },
    });
    expect(status).toBe(201);
    const recipients = (await jobMessageNotifs(appt.id)).map((n) => n.recipient_user_id);
    expect(recipients).toEqual([org.homeowner.userId]);
  });

  it('reuses one conversation across multiple sends on the same appointment', async () => {
    const appt = await confirmedAppt();
    for (const content of ['one', 'two']) {
      await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.homeowner.accessToken),
        body: { content },
      });
    }
    const { data: convs } = await admin.from('conversations').select('id').eq('appointment_id', appt.id);
    expect(convs).toHaveLength(1);
    const { data: msgs } = await admin.from('messages').select('id').eq('appointment_id', appt.id);
    expect(msgs).toHaveLength(2);
  });

  it('recurring: two appointments for the same homeowner+cleaner get DISTINCT threads', async () => {
    const a1 = await confirmedAppt();
    const a2 = await confirmedAppt();
    await callRoute(handlerFor(a1.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'thread 1' },
    });
    await callRoute(handlerFor(a2.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'thread 2' },
    });
    const { data: c1 } = await admin.from('conversations').select('id').eq('appointment_id', a1.id).single();
    const { data: c2 } = await admin.from('conversations').select('id').eq('appointment_id', a2.id).single();
    expect(c1!.id).not.toBe(c2!.id);
  });

  it('409 when no cleaner is assigned yet', async () => {
    const appt = await confirmedAppt();
    await admin.from('appointments').update({ cleaner_id: null }).eq('id', appt.id);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'anyone there?' },
    });
    expect(status).toBe(409);
  });

  it('403 when the org kill-switch is off', async () => {
    const appt = await confirmedAppt();
    await admin
      .from('organizations')
      .update({ homeowner_cleaner_messaging_enabled: false })
      .eq('id', org.organizationId);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'blocked?' },
    });
    expect(status).toBe(403);
  });

  it('403 when the window is closed (pending)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'pending',
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'too early' },
    });
    expect(status).toBe(403);
  });

  it('403 when cancelled', async () => {
    const appt = await confirmedAppt();
    await admin.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'too late' },
    });
    expect(status).toBe(403);
  });

  it('201 within the 24h grace, 403 after it', async () => {
    const within = await confirmedAppt();
    await admin
      .from('appointments')
      .update({ status: 'completed', completed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .eq('id', within.id);
    const okRes = await callRoute(handlerFor(within.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'thanks!' },
    });
    expect(okRes.status).toBe(201);

    const after = await confirmedAppt();
    await admin
      .from('appointments')
      .update({ status: 'completed', completed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })
      .eq('id', after.id);
    const lateRes = await callRoute(handlerFor(after.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'too late now' },
    });
    expect(lateRes.status).toBe(403);
  });

  it('400 for empty content', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: '   ' },
    });
    expect(status).toBe(400);
  });

  it('400 for content over the max length', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'x'.repeat(4001) },
    });
    expect(status).toBe(400);
  });

  it('reassignment: the old cleaner can no longer send (403)', async () => {
    const appt = await confirmedAppt();
    // True reassignment to a different cleaner. org2.cleaner has a cleaner_profiles
    // row, so the FK (appointments.cleaner_id -> cleaner_profiles(id)) is satisfied
    // (the FK is org-agnostic). Assert the update applied so a future FK regression
    // surfaces here rather than as a silent no-op.
    const { error: reassignError } = await admin
      .from('appointments')
      .update({ cleaner_id: org2.cleaner.userId })
      .eq('id', appt.id);
    expect(reassignError).toBeNull();

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { content: 'still me?' },
    });
    expect(status).toBe(403);
  });

  it('RLS: participants + org staff can read the job messages; outsiders cannot', async () => {
    const appt = await confirmedAppt();
    await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'visible?' },
    });

    const cleanerClient = createUserClient(org.cleaner.accessToken);
    const { data: cleanerView } = await cleanerClient.from('messages').select('id').eq('appointment_id', appt.id);
    expect((cleanerView ?? []).length).toBeGreaterThan(0);

    const staffClient = createUserClient(org.admin.accessToken); // org admin -> org-staff messages read
    const { data: staffView } = await staffClient.from('messages').select('id').eq('appointment_id', appt.id);
    expect((staffView ?? []).length).toBeGreaterThan(0);

    const outsiderClient = createUserClient(org2.homeowner.accessToken);
    const { data: outsiderView } = await outsiderClient.from('messages').select('id').eq('appointment_id', appt.id);
    expect(outsiderView ?? []).toHaveLength(0);
  });
});
