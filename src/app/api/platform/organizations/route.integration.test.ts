import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';
import type { PlatformOrgSummary } from '@/types/platform';

describe('GET /api/platform/organizations', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('returns 401 without a token', async () => {
    const { status } = await callRoute(GET, { method: 'GET' });
    expect(status).toBe(401);
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns orgs with member counts for a platform admin', async () => {
    [admin, org] = await Promise.all([withPlatformAdmin(), withTestOrg()]);
    const { status, body } = await callRoute<{ organizations: PlatformOrgSummary[] }>(GET, {
      method: 'GET',
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(200);
    const mine = body.organizations.find((o) => o.id === org!.organizationId);
    expect(mine).toBeDefined();
    expect(mine!.member_counts.admin).toBe(1);
    expect(mine!.member_counts.cleaner).toBe(1);
    expect(mine!.member_counts.homeowner).toBe(1);
    expect(mine!.member_counts.total).toBe(3);
  });
});
