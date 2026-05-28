import { describe, it, expect, afterEach } from 'vitest';
import { DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/**
 * Security regression: delete-cleaner had NO caller auth — anyone who could
 * reach it could delete any cleaner. It now derives the cleaner's org from
 * cleaner_profiles and requires the caller to be an owner/admin of THAT org.
 */
describe('DELETE /api/admin/delete-cleaner (authorization)', () => {
  let org: TestOrgFixture | null = null;
  let otherOrg: TestOrgFixture | null = null;

  afterEach(async () => {
    await Promise.all([org?.cleanup(), otherOrg?.cleanup()]);
    org = null;
    otherOrg = null;
  });

  const url = (cleanerId: string) =>
    `http://test.local/api/admin/delete-cleaner?id=${encodeURIComponent(cleanerId)}`;

  it('401 without a token', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(DELETE, { method: 'DELETE', url: url(org.cleaner.userId) });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(status).toBe(403);
  });

  it("rejects an admin from a different org (403) and leaves the cleaner intact", async () => {
    [org, otherOrg] = await Promise.all([withTestOrg(), withTestOrg()]);
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(otherOrg.admin.accessToken),
    });
    expect(status).toBe(403);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('cleaner_profiles')
      .select('id')
      .eq('id', org.cleaner.userId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it('lets the org admin delete a cleaner (200)', async () => {
    org = await withTestOrg();
    const { status, body } = await callRoute<{ success: boolean }>(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('cleaner_profiles')
      .select('id')
      .eq('id', org.cleaner.userId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('404 for a non-existent cleaner', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url('00000000-0000-0000-0000-000000000000'),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(404);
  });
});
