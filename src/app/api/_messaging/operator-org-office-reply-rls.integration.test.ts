// src/app/api/_messaging/operator-org-office-reply-rls.integration.test.ts
//
// Real-RLS coverage for sub-project 1b (org-scoped operator office inbox).
// Proves the RLS the org-office useConversations mode + operator reply path
// rely on:
//   - a non-participant org manager can READ the org's office thread (099
//     conversations_select_org_office) and its messages (089 messages_select
//     branch 3: org admin/manager).
//   - that same non-participant manager can INSERT a reply (089 messages_insert
//     branch 2: sender_id = self AND is_admin_or_manager_in_org(org)).
//   - a manager of a DIFFERENT org cannot read the thread.
//
// Run in isolation (the integration suite flakes on parallel GoTrue auth):
//   npm run test:integration -- operator-org-office-reply-rls
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import {
  withTestOrg,
  addManagerToOrg,
  type TestOrgFixture,
  type ManagerMemberHandle,
} from '../../../../tests/helpers/fixtures';

const admin = createTestSupabaseClient();

describe('operator org-office read + reply RLS (1b)', () => {
  let orgA: TestOrgFixture;
  let orgB: TestOrgFixture;
  let managerA: ManagerMemberHandle; // org A staff, NOT a participant of the thread
  let managerB: ManagerMemberHandle; // org B staff (cross-org)
  let officeConvId: string;

  beforeAll(async () => {
    [orgA, orgB] = await Promise.all([withTestOrg(), withTestOrg()]);
    [managerA, managerB] = await Promise.all([
      addManagerToOrg(orgA.organizationId, { can_view_messages: true }),
      addManagerToOrg(orgB.organizationId, { can_view_messages: true }),
    ]);

    // OFFICE thread in orgA: homeowner <-> admin, appointment_id NULL. Leave
    // organization_id NULL so the 099 trigger backfills it from the first message.
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

    // Customer's opening message -> trigger sets conversations.organization_id = orgA.
    const { error: msgErr } = await admin.from('messages').insert({
      sender_id: orgA.homeowner.userId,
      recipient_id: orgA.admin.userId,
      content: 'Office thread: question for the team',
      organization_id: orgA.organizationId,
      conversation_id: officeConvId,
      appointment_id: null,
    });
    if (msgErr) throw new Error(`office message insert failed: ${msgErr.message}`);
  });

  afterAll(async () => {
    await Promise.all([managerA?.cleanup(), managerB?.cleanup()]);
    await Promise.all([orgA?.cleanup(), orgB?.cleanup()]);
  });

  it('a non-participant org manager can read the office thread + its messages', async () => {
    const client = createUserClient(managerA.accessToken);

    const { data: convs, error: convErr } = await client
      .from('conversations')
      .select('id, organization_id, appointment_id')
      .eq('id', officeConvId);
    expect(convErr).toBeNull();
    expect(convs).toHaveLength(1);
    expect(convs![0].organization_id).toBe(orgA.organizationId);
    expect(convs![0].appointment_id).toBeNull();

    const { data: msgs, error: msgErr } = await client
      .from('messages')
      .select('id, content')
      .eq('conversation_id', officeConvId);
    expect(msgErr).toBeNull();
    expect((msgs ?? []).length).toBeGreaterThan(0);
  });

  it('a non-participant org manager can reply (insert a message) into the office thread', async () => {
    const client = createUserClient(managerA.accessToken);

    // Reply routed to the CUSTOMER participant (the homeowner), sender = the
    // answering manager, org = the manager's org. messages_insert branch 2
    // authorizes this even though managerA is not a conversation participant.
    const { data: inserted, error: insertErr } = await client
      .from('messages')
      .insert({
        sender_id: managerA.userId,
        recipient_id: orgA.homeowner.userId,
        content: 'Thanks for reaching out, happy to help.',
        organization_id: orgA.organizationId,
        conversation_id: officeConvId,
        appointment_id: null,
      })
      .select('id, sender_id, recipient_id')
      .single();
    expect(insertErr).toBeNull();
    expect(inserted?.sender_id).toBe(managerA.userId);
    expect(inserted?.recipient_id).toBe(orgA.homeowner.userId);

    // Service-role confirms the reply landed in the thread.
    const { data: all } = await admin
      .from('messages')
      .select('id')
      .eq('conversation_id', officeConvId);
    expect((all ?? []).length).toBe(2);
  });

  it('a manager of a DIFFERENT org cannot read the office thread', async () => {
    const client = createUserClient(managerB.accessToken);
    const { data } = await client.from('conversations').select('id').eq('id', officeConvId);
    expect(data ?? []).toHaveLength(0);
  });
});
