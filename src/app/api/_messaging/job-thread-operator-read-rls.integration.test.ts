// src/app/api/_messaging/job-thread-operator-read-rls.integration.test.ts
//
// Real-RLS coverage for sub-project 2a (operator read-only "Messages on this
// job" panel). The operator reads a homeowner<->cleaner JOB thread as MESSAGES
// filtered by appointment_id (089 messages_select branch: org admin/manager),
// WITHOUT a conversations read policy (job threads deliberately get none; only
// office threads do, via 099). This proves:
//   - an org admin who is NOT a participant CAN read the job thread's messages
//     by appointment_id.
//   - they still CANNOT read the job CONVERSATION row (no job conversations
//     policy) -> the panel must read messages, not conversations.
//   - a manager of a DIFFERENT org cannot read the messages.
//   - an actual participant (the homeowner) can read them too (sanity).
//
// Run in isolation (the integration suite flakes on parallel GoTrue auth):
//   npm run test:integration -- job-thread-operator-read-rls
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import {
  withTestOrg,
  createTestAppointment,
  addManagerToOrg,
  type TestOrgFixture,
  type ManagerMemberHandle,
} from '../../../../tests/helpers/fixtures';

const admin = createTestSupabaseClient();

describe('operator reads job thread by appointment_id RLS (2a)', () => {
  let orgA: TestOrgFixture;
  let orgB: TestOrgFixture;
  let managerB: ManagerMemberHandle; // cross-org staff
  let appointmentId: string;
  let jobConvId: string;

  beforeAll(async () => {
    [orgA, orgB] = await Promise.all([withTestOrg(), withTestOrg()]);
    managerB = await addManagerToOrg(orgB.organizationId, { can_view_messages: true });

    // An appointment in org A with homeowner H + cleaner C (both org A members).
    const appt = await createTestAppointment({
      organizationId: orgA.organizationId,
      cleanerId: orgA.cleaner.userId,
      homeownerId: orgA.homeowner.userId,
      status: 'in_progress',
    });
    appointmentId = appt.id;

    // The per-appointment job conversation (appointment_id NON-null) + one message.
    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .insert({
        participant_1_id: orgA.homeowner.userId,
        participant_2_id: orgA.cleaner.userId,
        appointment_id: appointmentId,
      })
      .select('id')
      .single();
    if (convErr || !conv) throw new Error(`job conv insert failed: ${convErr?.message}`);
    jobConvId = conv.id as string;

    const { error: msgErr } = await admin.from('messages').insert({
      sender_id: orgA.homeowner.userId,
      recipient_id: orgA.cleaner.userId,
      content: 'Gate code is 1234, thanks!',
      organization_id: orgA.organizationId,
      conversation_id: jobConvId,
      appointment_id: appointmentId,
    });
    if (msgErr) throw new Error(`job message insert failed: ${msgErr.message}`);
  });

  afterAll(async () => {
    await Promise.all([managerB?.cleanup()]);
    await Promise.all([orgA?.cleanup(), orgB?.cleanup()]);
  });

  it('an org admin who is NOT a participant can read the job thread messages by appointment_id', async () => {
    const client = createUserClient(orgA.admin.accessToken);
    const { data, error } = await client
      .from('messages')
      .select('id, content, appointment_id')
      .eq('appointment_id', appointmentId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    expect(data![0].appointment_id).toBe(appointmentId);
  });

  it('that same org admin CANNOT read the job conversation row (no job conversations policy)', async () => {
    // Locks the design: job threads have no org-staff conversations read policy
    // (099 is office-only). The operator reads MESSAGES by appointment_id, never
    // the conversation row.
    const client = createUserClient(orgA.admin.accessToken);
    const { data } = await client.from('conversations').select('id').eq('id', jobConvId);
    expect(data ?? []).toHaveLength(0);
  });

  it('a manager of a DIFFERENT org cannot read the job thread messages', async () => {
    const client = createUserClient(managerB.accessToken);
    const { data } = await client
      .from('messages')
      .select('id')
      .eq('appointment_id', appointmentId);
    expect(data ?? []).toHaveLength(0);
  });

  it('a participant (the homeowner) can read the job thread messages by appointment_id', async () => {
    const client = createUserClient(orgA.homeowner.accessToken);
    const { data, error } = await client
      .from('messages')
      .select('id')
      .eq('appointment_id', appointmentId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
