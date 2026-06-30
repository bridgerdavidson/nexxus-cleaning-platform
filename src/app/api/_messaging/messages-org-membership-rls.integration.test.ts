// src/app/api/_messaging/messages-org-membership-rls.integration.test.ts
//
// Real-RLS integration coverage for migration 100 (messages_insert org-membership
// hardening). messages.organization_id is client-supplied; the first (customer)
// branch of messages_insert now requires the sender to be a member of that org,
// so a homeowner/cleaner can no longer stamp a message with a FOREIGN org_id
// (which migration 099's trigger would then propagate to the conversation,
// leaking metadata to the foreign org's staff via conversations_select_org_office).
//
// Each assertion exercises real RLS via a user-scoped client (createUserClient),
// NOT the service-role admin client (which bypasses RLS).
//
// Run in isolation (the integration suite flakes on parallel GoTrue auth):
//   npm run test:integration -- messages-org-membership-rls
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';

describe('messages_insert org-membership RLS (100)', () => {
  let orgA: TestOrgFixture;
  let orgB: TestOrgFixture;

  beforeAll(async () => {
    [orgA, orgB] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterAll(async () => {
    await Promise.all([orgA?.cleanup(), orgB?.cleanup()]);
  });

  it('homeowner member of org A CAN insert a message stamped with org A (branch 1)', async () => {
    // Sender is a member of org A; recipient is org A's admin (a homeowner may
    // message admins/managers per can_message_role) -> branch 1 passes.
    const client = createUserClient(orgA.homeowner.accessToken);
    const { data, error } = await client
      .from('messages')
      .insert({
        sender_id: orgA.homeowner.userId,
        recipient_id: orgA.admin.userId,
        content: 'Question for the office',
        organization_id: orgA.organizationId,
      })
      .select('id, organization_id')
      .single();

    expect(error).toBeNull();
    expect(data?.organization_id).toBe(orgA.organizationId);
  });

  it('homeowner of org A CANNOT insert a message stamped with a FOREIGN org B (spoof blocked)', async () => {
    // Same sender + same messageable recipient as the success case; ONLY the
    // organization_id changes to org B (which the homeowner is not a member of).
    // Branch 1 fails on is_org_member(B); branch 2 fails (not admin/manager of B).
    const client = createUserClient(orgA.homeowner.accessToken);
    const { data, error } = await client
      .from('messages')
      .insert({
        sender_id: orgA.homeowner.userId,
        recipient_id: orgA.admin.userId,
        content: 'Spoofing org B',
        organization_id: orgB.organizationId,
      })
      .select('id');

    expect(error).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('admin of org A CAN insert a message stamped with org A (branch 2)', async () => {
    const client = createUserClient(orgA.admin.accessToken);
    const { data, error } = await client
      .from('messages')
      .insert({
        sender_id: orgA.admin.userId,
        recipient_id: orgA.homeowner.userId,
        content: 'Office reply',
        organization_id: orgA.organizationId,
      })
      .select('id, organization_id')
      .single();

    expect(error).toBeNull();
    expect(data?.organization_id).toBe(orgA.organizationId);
  });
});
