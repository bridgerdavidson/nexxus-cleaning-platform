import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import {
  withTestOrg,
  addOwnerToOrg,
  addManagerToOrg,
  type TestOrgFixture,
  type OwnerMemberHandle,
  type ManagerMemberHandle,
} from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

/**
 * Regression: an org OWNER (organization_members.role = 'owner') must be able to
 * list invites. The route gated on role === 'admin', which excluded owners and
 * produced the "Not authorized to view invites" 403 the founder hit during
 * onboarding. Owners and admins are allowed; cleaners are not.
 */
describe('GET /api/invites (owner authorization)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;

  afterEach(async () => {
    await owner?.cleanup();
    await org?.cleanup();
    owner = null;
    org = null;
  });

  const url = (organizationId: string) =>
    `http://test.local/api/invites?organizationId=${organizationId}`;

  it('401 without a token', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, { method: 'GET', url: url(org.organizationId) });
    expect(status).toBe(401);
  });

  it('allows an org owner to list invites (200)', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);

    const { status, body } = await callRoute<{ success: boolean; invites: unknown[] }>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(owner.accessToken),
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.invites)).toBe(true);
  });

  it('allows an org admin to list invites (200)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(200);
  });

  it('rejects a cleaner (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(status).toBe(403);
  });
});

/**
 * Homeowner (customer) invites must not leak to a manager who can manage cleaners
 * but has no customer permission — they would otherwise read customer email
 * addresses through this list. Managers with a customer permission see them.
 */
describe('GET /api/invites (homeowner row visibility)', () => {
  let org: TestOrgFixture | null = null;
  let manager: ManagerMemberHandle | null = null;

  afterEach(async () => {
    await manager?.cleanup();
    await org?.cleanup();
    manager = null;
    org = null;
  });

  const url = (organizationId: string) =>
    `http://test.local/api/invites?organizationId=${organizationId}`;

  async function seedCleanerAndHomeownerInvites(organizationId: string, invitedBy: string) {
    const db = createTestSupabaseClient();
    const uniq = randomUUID().slice(0, 8);
    const { error } = await db.from('invites').insert([
      { organization_id: organizationId, email: `cleaner-inv-${uniq}@test.local`, role: 'cleaner', status: 'pending', invited_by: invitedBy },
      { organization_id: organizationId, email: `home-inv-${uniq}@test.local`, role: 'homeowner', status: 'pending', invited_by: invitedBy },
    ]);
    if (error) throw new Error(`seed invites failed: ${error.message}`);
  }

  it('hides homeowner invites from a manager without customer permission', async () => {
    org = await withTestOrg();
    await seedCleanerAndHomeownerInvites(org.organizationId, org.admin.userId);
    manager = await addManagerToOrg(org.organizationId, { can_manage_cleaners: true });

    const { status, body } = await callRoute<{ success: boolean; invites: { role: string }[] }>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(manager.accessToken),
    });

    expect(status).toBe(200);
    const roles = body.invites.map((i) => i.role);
    expect(roles).toContain('cleaner');
    expect(roles).not.toContain('homeowner');
  });

  it('shows homeowner invites to a manager with can_view_customers', async () => {
    org = await withTestOrg();
    await seedCleanerAndHomeownerInvites(org.organizationId, org.admin.userId);
    manager = await addManagerToOrg(org.organizationId, {
      can_manage_cleaners: true,
      can_view_customers: true,
    });

    const { status, body } = await callRoute<{ success: boolean; invites: { role: string }[] }>(GET, {
      method: 'GET',
      url: url(org.organizationId),
      headers: bearerHeader(manager.accessToken),
    });

    expect(status).toBe(200);
    const roles = body.invites.map((i) => i.role);
    expect(roles).toContain('cleaner');
    expect(roles).toContain('homeowner');
  });
});
