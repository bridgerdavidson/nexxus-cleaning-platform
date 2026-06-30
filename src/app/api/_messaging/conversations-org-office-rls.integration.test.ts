// src/app/api/_messaging/conversations-org-office-rls.integration.test.ts
//
// Real-RLS integration coverage for migration 099:
//   - conversations.organization_id is set on the first message via the
//     trg_set_conversation_org trigger.
//   - the new permissive conversations_select_org_office policy lets org
//     admins/managers read their org's OFFICE threads (appointment_id IS NULL)
//     even when they are not a participant, while leaving job threads, other
//     orgs, and non-staff users excluded.
//
// Run in isolation (the integration suite flakes on parallel GoTrue auth):
//   npm run test:integration -- conversations-org-office-rls
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import {
  withTestOrg,
  addManagerToOrg,
  createTestAppointment,
  type TestOrgFixture,
  type ManagerMemberHandle,
} from '../../../../tests/helpers/fixtures';

const admin = createTestSupabaseClient();

describe('conversations org-staff office-read RLS (099)', () => {
  let orgA: TestOrgFixture;
  let orgB: TestOrgFixture;
  let managerA: ManagerMemberHandle;
  let managerB: ManagerMemberHandle;
  let officeConvId: string;
  let jobConvId: string;

  beforeAll(async () => {
    [orgA, orgB] = await Promise.all([withTestOrg(), withTestOrg()]);
    [managerA, managerB] = await Promise.all([
      addManagerToOrg(orgA.organizationId),
      addManagerToOrg(orgB.organizationId),
    ]);

    // OFFICE thread in orgA: homeowner <-> admin, appointment_id NULL,
    // organization_id intentionally left NULL so the trigger sets it.
    const { data: officeConv, error: officeErr } = await admin
      .from('conversations')
      .insert({
        participant_1_id: orgA.homeowner.userId,
        participant_2_id: orgA.admin.userId,
        appointment_id: null,
      })
      .select('id')
      .single();
    if (officeErr || !officeConv) throw new Error(`office conv insert failed: ${officeErr?.message}`);
    officeConvId = officeConv.id as string;

    // One message in the office thread -> trigger sets conversations.organization_id = orgA.
    const { error: officeMsgErr } = await admin.from('messages').insert({
      sender_id: orgA.homeowner.userId,
      recipient_id: orgA.admin.userId,
      content: 'Office thread: question for the team',
      organization_id: orgA.organizationId,
      conversation_id: officeConvId,
      appointment_id: null,
    });
    if (officeMsgErr) throw new Error(`office message insert failed: ${officeMsgErr.message}`);

    // JOB thread in orgA: appointment_id set (homeowner <-> cleaner).
    const appt = await createTestAppointment({
      organizationId: orgA.organizationId,
      cleanerId: orgA.cleaner.userId,
      homeownerId: orgA.homeowner.userId,
      status: 'confirmed',
    });
    const { data: jobConv, error: jobErr } = await admin
      .from('conversations')
      .insert({
        participant_1_id: orgA.homeowner.userId,
        participant_2_id: orgA.cleaner.userId,
        appointment_id: appt.id,
      })
      .select('id')
      .single();
    if (jobErr || !jobConv) throw new Error(`job conv insert failed: ${jobErr?.message}`);
    jobConvId = jobConv.id as string;

    // Message in the job thread so it too carries organization_id = orgA. This
    // proves assertion 3 is excluded by appointment_id, not by a missing org.
    const { error: jobMsgErr } = await admin.from('messages').insert({
      sender_id: orgA.homeowner.userId,
      recipient_id: orgA.cleaner.userId,
      content: 'Job thread: gate code is 1234',
      organization_id: orgA.organizationId,
      conversation_id: jobConvId,
      appointment_id: appt.id,
    });
    if (jobMsgErr) throw new Error(`job message insert failed: ${jobMsgErr.message}`);
  });

  afterAll(async () => {
    await Promise.all([managerA?.cleanup(), managerB?.cleanup()]);
    await Promise.all([orgA?.cleanup(), orgB?.cleanup()]);
  });

  it('org manager who is NOT a participant can read their org office thread', async () => {
    const client = createUserClient(managerA.accessToken);
    const { data, error } = await client
      .from('conversations')
      .select('id, organization_id, appointment_id')
      .eq('id', officeConvId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(officeConvId);
    // The trigger set the org from the first message.
    expect(data![0].organization_id).toBe(orgA.organizationId);
    expect(data![0].appointment_id).toBeNull();
  });

  it('org staff CANNOT read another org office thread', async () => {
    const client = createUserClient(managerB.accessToken);
    const { data } = await client.from('conversations').select('id').eq('id', officeConvId);
    expect(data ?? []).toHaveLength(0);
  });

  it('org staff CANNOT read a job thread via conversations (appointment_id set)', async () => {
    const client = createUserClient(managerA.accessToken);
    const { data } = await client.from('conversations').select('id').eq('id', jobConvId);
    // Job office-read is via messages, not conversations; the office-only policy
    // excludes appointment_id IS NOT NULL, and managerA is not a participant.
    expect(data ?? []).toHaveLength(0);
  });

  it('a non-staff user who is not a participant CANNOT read the office thread', async () => {
    // orgB's homeowner: a real authenticated user, non-staff in orgA, and not a
    // participant of orgA's office thread.
    const client = createUserClient(orgB.homeowner.accessToken);
    const { data } = await client.from('conversations').select('id').eq('id', officeConvId);
    expect(data ?? []).toHaveLength(0);
  });

  it('trigger sets organization_id when the first message is inserted', async () => {
    // Service-role: create an office conversation with organization_id NULL.
    // Use a fresh participant pair (homeowner <-> cleaner) so it does not collide
    // with the homeowner<->admin office thread from beforeAll under the
    // unique_office_conversation partial index (098, appointment_id IS NULL).
    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .insert({
        participant_1_id: orgA.homeowner.userId,
        participant_2_id: orgA.cleaner.userId,
        appointment_id: null,
      })
      .select('id, organization_id')
      .single();
    if (convErr || !conv) throw new Error(`trigger-test conv insert failed: ${convErr?.message}`);
    expect(conv.organization_id).toBeNull();

    // Insert a message with organization_id = orgA -> trigger backfills the conv.
    const { error: msgErr } = await admin.from('messages').insert({
      sender_id: orgA.homeowner.userId,
      recipient_id: orgA.cleaner.userId,
      content: 'first message sets the org',
      organization_id: orgA.organizationId,
      conversation_id: conv.id,
      appointment_id: null,
    });
    if (msgErr) throw new Error(`trigger-test message insert failed: ${msgErr.message}`);

    const { data: after } = await admin
      .from('conversations')
      .select('organization_id')
      .eq('id', conv.id)
      .single();
    expect(after?.organization_id).toBe(orgA.organizationId);
  });
});
