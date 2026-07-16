import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import type { PlatformAuditEntry } from '@/types/platform';

const BASE = 'http://test.local/api/platform/audit';

interface AuditResponse {
  entries: PlatformAuditEntry[];
  nextOffset: number | null;
}

describe('GET /api/platform/audit', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;
  const seededIds: string[] = [];

  afterEach(async () => {
    if (seededIds.length) {
      await createTestSupabaseClient().from('platform_audit_log').delete().in('id', seededIds);
      seededIds.length = 0;
    }
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('returns 401 without a token', async () => {
    const { status } = await callRoute(GET, { method: 'GET', url: BASE });
    expect(status).toBe(401);
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: BASE,
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns org-scoped entries newest-first with resolved names, and paginates', async () => {
    [admin, org] = await Promise.all([withPlatformAdmin(), withTestOrg()]);
    const db = createTestSupabaseClient();
    const { data: inserted, error } = await db
      .from('platform_audit_log')
      .insert([
        {
          actor_user_id: admin.userId,
          action: 'reset_tenant_connect',
          target_org_id: org.organizationId,
          metadata: {},
          started_at: '2026-01-01T00:00:00Z',
        },
        {
          actor_user_id: admin.userId,
          action: 'impersonation_start',
          target_org_id: org.organizationId,
          metadata: { via: 'test' },
          started_at: '2026-01-02T00:00:00Z',
        },
        {
          // null target org (e.g. a deleted tenant) - must be excluded by the org filter
          actor_user_id: admin.userId,
          action: 'delete_tenant',
          target_org_id: null,
          metadata: {},
          started_at: '2026-01-03T00:00:00Z',
        },
      ])
      .select('id');
    expect(error).toBeNull();
    seededIds.push(...((inserted ?? []) as { id: string }[]).map((r) => r.id));

    // Full page, org-scoped: exactly the 2 with this target_org_id, newest-first.
    const { status, body } = await callRoute<AuditResponse>(GET, {
      method: 'GET',
      url: `${BASE}?org_id=${org.organizationId}`,
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map((e) => e.action)).toEqual(['impersonation_start', 'reset_tenant_connect']);
    expect(body.entries.every((e) => e.target_org_id === org!.organizationId)).toBe(true);
    // actor + org names resolved
    expect(body.entries[0].actor_name).toBe('Platform Admin');
    expect(body.entries[0].actor_email).toBe(admin.email);
    expect(typeof body.entries[0].target_org_name).toBe('string');
    expect(body.entries[0].target_org_name).toContain('Test Org');
    expect(body.nextOffset).toBeNull();

    // Pagination: limit=1 returns the newest + nextOffset=1; next page returns the other + null.
    const page1 = await callRoute<AuditResponse>(GET, {
      method: 'GET',
      url: `${BASE}?org_id=${org.organizationId}&limit=1`,
      headers: bearerHeader(admin.accessToken),
    });
    expect(page1.body.entries).toHaveLength(1);
    expect(page1.body.entries[0].action).toBe('impersonation_start');
    expect(page1.body.nextOffset).toBe(1);

    const page2 = await callRoute<AuditResponse>(GET, {
      method: 'GET',
      url: `${BASE}?org_id=${org.organizationId}&limit=1&offset=1`,
      headers: bearerHeader(admin.accessToken),
    });
    expect(page2.body.entries).toHaveLength(1);
    expect(page2.body.entries[0].action).toBe('reset_tenant_connect');
    expect(page2.body.nextOffset).toBeNull();
  });
});
