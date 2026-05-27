import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../../tests/helpers/fixtures';
import type { PlatformOrgDetail } from '@/types/platform';

const handlerFor = (id: string) => (req: NextRequest) =>
  GET(req, { params: Promise.resolve({ id }) });

describe('GET /api/platform/organizations/:id', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns 404 for an unknown org id', async () => {
    admin = await withPlatformAdmin();
    const { status } = await callRoute(handlerFor('00000000-0000-0000-0000-000000000000'), {
      method: 'GET',
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(404);
  });

  it('returns the org detail + member roster for a platform admin', async () => {
    [admin, org] = await Promise.all([withPlatformAdmin(), withTestOrg()]);
    const { status, body } = await callRoute<{ organization: PlatformOrgDetail }>(
      handlerFor(org.organizationId),
      { method: 'GET', headers: bearerHeader(admin.accessToken) },
    );
    expect(status).toBe(200);
    expect(body.organization.id).toBe(org.organizationId);
    expect(body.organization.member_counts.total).toBe(3);
    expect(body.organization.members).toHaveLength(3);
    const emails = body.organization.members.map((m) => m.email);
    expect(emails).toContain(org.admin.email);
    expect(body.organization.counts.appointments).toBe(0);
  });
});
