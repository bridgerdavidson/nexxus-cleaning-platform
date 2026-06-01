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

  it('returns 200 + isPlatformAdmin:false for a normal org user (not a platform admin)', async () => {
    // A valid token that simply isn't in platform_admins is a definitive,
    // non-error answer ("you're not a platform admin"), returned as 200 so it
    // doesn't surface as a console 403 on every dashboard load and so the client
    // can cache it. Authorization for the actual /api/platform/* data routes is
    // still enforced with 403 by requirePlatformAdmin.
    org = await withTestOrg();
    const { status, body } = await callRoute<{ isPlatformAdmin: boolean }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(200);
    expect(body.isPlatformAdmin).toBe(false);
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
