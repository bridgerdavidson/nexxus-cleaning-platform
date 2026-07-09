import { describe, it, expect, afterEach } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, addManagerToOrg } from '../../../../tests/helpers/fixtures';

// Migration 104 splits the manager branch out of the live service_types /
// properties write policies (076 / 074) and gates it on the manager's
// fine-grained flag (can_manage_services / can_edit_properties) instead of
// letting any org manager write unconditionally. These tests prove RLS
// actually enforces the flag (not just app code), for both tables, and that
// the owner/admin branch of the rewritten policy still works.

const admin = createTestSupabaseClient();
let org: Awaited<ReturnType<typeof withTestOrg>> | null = null;
let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

afterEach(async () => {
  if (mgr) {
    await mgr.cleanup();
    mgr = null;
  }
  if (org) {
    await org.cleanup();
    org = null;
  }
});

async function seedService(orgId: string) {
  const { data, error } = await admin
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

// Homeowner-owned property in the org: the properties write policy's manager
// branch requires the target property's owner to be a `homeowner` org member
// in the SAME organization as the acting manager (om_target join), so the
// owner must be `org.homeowner.userId`, not an arbitrary user.
async function seedProperty(orgId: string, ownerId: string) {
  const { data, error } = await admin
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: ownerId,
      name: 'Test Property',
      address: '1 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '00000',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

// Org-owned (self-pay, migration 077) property: owner_id is null. The
// properties write policy's self-pay branch (added back by this fix) is
// gated on org membership + can_edit_properties only, no om_target join
// (there is no homeowner to join through).
async function seedOrgOwnedProperty(orgId: string) {
  const { data, error } = await admin
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: null,
      name: 'Org Owned Property',
      address: '2 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '00000',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

describe('manager RLS: service_types write requires can_manage_services', () => {
  it('denies a manager without the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    const svcId = await seedService(org.organizationId);
    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db.from('service_types').update({ name: 'Hacked' }).eq('id', svcId).select('id');
    expect(error).toBeNull(); // RLS silently filters rows out; a real error would masquerade as "blocked"
    expect(data ?? []).toHaveLength(0); // RLS blocked the row
  });

  it('allows a manager with the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    const svcId = await seedService(org.organizationId);
    const db = createUserClient(mgr.accessToken);
    const { data } = await db.from('service_types').update({ name: 'OK' }).eq('id', svcId).select('id');
    expect(data ?? []).toHaveLength(1);
  });
});

describe('manager RLS: properties write requires can_edit_properties', () => {
  it('denies a manager without the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: false });
    const propId = await seedProperty(org.organizationId, org.homeowner.userId);
    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db.from('properties').update({ name: 'Hacked' }).eq('id', propId).select('id');
    expect(error).toBeNull(); // RLS silently filters rows out; a real error would masquerade as "blocked"
    expect(data ?? []).toHaveLength(0); // RLS blocked the row
  });

  it('allows a manager with the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: true });
    const propId = await seedProperty(org.organizationId, org.homeowner.userId);
    const db = createUserClient(mgr.accessToken);
    const { data } = await db.from('properties').update({ name: 'OK' }).eq('id', propId).select('id');
    expect(data ?? []).toHaveLength(1);
  });
});

// Self-pay (migration 077): org-owned properties (owner_id IS NULL) have their
// own write branch, re-added by this fix after migration 104 dropped it while
// splitting the manager branch out. These prove RLS still lets org owner/admin
// write org-owned properties, and that the manager branch here is ALSO gated
// on can_edit_properties (same flag as the homeowner-owned branch above).
describe('manager RLS: org-owned (self-pay) property write requires can_edit_properties', () => {
  it('denies a manager without the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: false });
    const propId = await seedOrgOwnedProperty(org.organizationId);
    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db.from('properties').update({ name: 'Hacked' }).eq('id', propId).select('id');
    expect(error).toBeNull(); // RLS silently filters rows out; a real error would masquerade as "blocked"
    expect(data ?? []).toHaveLength(0); // RLS blocked the row
  });

  it('allows a manager with the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: true });
    const propId = await seedOrgOwnedProperty(org.organizationId);
    const db = createUserClient(mgr.accessToken);
    const { data } = await db.from('properties').update({ name: 'OK' }).eq('id', propId).select('id');
    expect(data ?? []).toHaveLength(1);
  });

  it('regression: org admin still updates an org-owned property under RLS', async () => {
    org = await withTestOrg();
    const propId = await seedOrgOwnedProperty(org.organizationId);
    const db = createUserClient(org.admin.accessToken);
    const { data } = await db.from('properties').update({ name: 'Admin OK' }).eq('id', propId).select('id');
    expect(data ?? []).toHaveLength(1);
  });
});

describe('regression: org admin can still write service_types and properties after the rewrite', () => {
  it('org admin updates a service_type under RLS', async () => {
    org = await withTestOrg();
    const svcId = await seedService(org.organizationId);
    const db = createUserClient(org.admin.accessToken);
    const { data } = await db.from('service_types').update({ name: 'Admin OK' }).eq('id', svcId).select('id');
    expect(data ?? []).toHaveLength(1);
  });

  it('org admin updates a property under RLS', async () => {
    org = await withTestOrg();
    const propId = await seedProperty(org.organizationId, org.homeowner.userId);
    const db = createUserClient(org.admin.accessToken);
    const { data } = await db.from('properties').update({ name: 'Admin OK' }).eq('id', propId).select('id');
    expect(data ?? []).toHaveLength(1);
  });
});
