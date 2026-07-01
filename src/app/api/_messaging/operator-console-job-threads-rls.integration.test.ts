// src/app/api/_messaging/operator-console-job-threads-rls.integration.test.ts
//
// Real-RLS coverage for sub-project 2b (operator console job-thread section).
// The console lists the org's homeowner<->cleaner JOB threads by reducing
// `messages` filtered `organization_id = org AND appointment_id IS NOT NULL`
// (089 org-staff messages_select), spanning MULTIPLE appointments, with NO
// conversations read (job threads have no org-staff conversations policy) and
// NO new migration. This proves:
//   - an org admin reads the org's job messages across all its job threads.
//   - a manager of a DIFFERENT org reads none.
//   - the org admin still cannot read the job CONVERSATION rows (the console
//     lists from messages, not conversations).
//
// Run in isolation (the integration suite flakes on parallel GoTrue auth):
//   npm run test:integration -- operator-console-job-threads-rls
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

describe('operator console lists org job threads by org + appointment_id RLS (2b)', () => {
  let orgA: TestOrgFixture;
  let orgB: TestOrgFixture;
  let managerB: ManagerMemberHandle;
  const apptIds: string[] = [];
  const jobConvIds: string[] = [];

  beforeAll(async () => {
    [orgA, orgB] = await Promise.all([withTestOrg(), withTestOrg()]);
    managerB = await addManagerToOrg(orgB.organizationId, { can_view_messages: true });

    // Two appointments in org A, each with homeowner H + cleaner C, each with its
    // own job thread + a message. The console must surface BOTH threads.
    for (let i = 0; i < 2; i++) {
      const appt = await createTestAppointment({
        organizationId: orgA.organizationId,
        cleanerId: orgA.cleaner.userId,
        homeownerId: orgA.homeowner.userId,
        status: 'in_progress',
      });
      apptIds.push(appt.id);

      const { data: conv, error: convErr } = await admin
        .from('conversations')
        .insert({
          participant_1_id: orgA.homeowner.userId,
          participant_2_id: orgA.cleaner.userId,
          appointment_id: appt.id,
        })
        .select('id')
        .single();
      if (convErr || !conv) throw new Error(`job conv ${i} insert failed: ${convErr?.message}`);
      jobConvIds.push(conv.id as string);

      const { error: msgErr } = await admin.from('messages').insert({
        sender_id: orgA.homeowner.userId,
        recipient_id: orgA.cleaner.userId,
        content: `Job ${i} message`,
        organization_id: orgA.organizationId,
        conversation_id: conv.id as string,
        appointment_id: appt.id,
      });
      if (msgErr) throw new Error(`job message ${i} insert failed: ${msgErr.message}`);
    }
  });

  afterAll(async () => {
    await Promise.all([managerB?.cleanup()]);
    await Promise.all([orgA?.cleanup(), orgB?.cleanup()]);
  });

  it('an org admin reads the org job messages across ALL its job threads', async () => {
    const client = createUserClient(orgA.admin.accessToken);
    const { data, error } = await client
      .from('messages')
      .select('id, appointment_id')
      .eq('organization_id', orgA.organizationId)
      .not('appointment_id', 'is', null);
    expect(error).toBeNull();
    const appts = new Set((data ?? []).map(r => r.appointment_id));
    expect(appts.size).toBe(2);
    expect([...appts].sort()).toEqual([...apptIds].sort());
  });

  it('a manager of a DIFFERENT org reads no job messages', async () => {
    const client = createUserClient(managerB.accessToken);
    const { data } = await client
      .from('messages')
      .select('id')
      .eq('organization_id', orgA.organizationId)
      .not('appointment_id', 'is', null);
    expect(data ?? []).toHaveLength(0);
  });

  it('the org admin still cannot read the job conversation rows', async () => {
    const client = createUserClient(orgA.admin.accessToken);
    const { data } = await client.from('conversations').select('id').in('id', jobConvIds);
    expect(data ?? []).toHaveLength(0);
  });
});
