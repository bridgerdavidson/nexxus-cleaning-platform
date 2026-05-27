import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';

describe('GET /api/platform/whoami', () => {
  let platformAdmin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await Promise.all([platformAdmin?.cleanup(), org?.cleanup()]);
    platformAdmin = null;
    org = null;
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(GET, { method: 'GET' });
    expect(status).toBe(401);
  });

  it('returns 403 for a normal org user (not a platform admin)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns 200 + isPlatformAdmin:true for a platform admin', async () => {
    platformAdmin = await withPlatformAdmin();
    const { status, body } = await callRoute<{ isPlatformAdmin: boolean; userId: string }>(GET, {
      method: 'GET',
      headers: bearerHeader(platformAdmin.accessToken),
    });
    expect(status).toBe(200);
    expect(body.isPlatformAdmin).toBe(true);
    expect(body.userId).toBe(platformAdmin.userId);
  });
});
