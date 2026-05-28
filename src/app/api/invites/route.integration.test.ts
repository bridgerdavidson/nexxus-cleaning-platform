import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import {
  withTestOrg,
  addOwnerToOrg,
  type TestOrgFixture,
  type OwnerMemberHandle,
} from '../../../../tests/helpers/fixtures';

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
