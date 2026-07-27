import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { PATCH } from './[id]/route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import type { PlatformAlert } from '@/types/platform';

const BASE = 'http://test.local/api/platform/alerts';

interface AlertsResponse {
  alerts: PlatformAlert[];
  nextOffset: number | null;
}

const patchHandler = (id: string) => (req: NextRequest) =>
  PATCH(req, { params: Promise.resolve({ id }) });

describe('platform alerts routes', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;
  const seededIds: string[] = [];

  afterEach(async () => {
    if (seededIds.length) {
      await createTestSupabaseClient().from('platform_alerts').delete().in('id', seededIds);
      seededIds.length = 0;
    }
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  // Far-future last_seen_at so these seeds sort to the top of the list regardless of
  // other rows on the shared local DB (ordering is last_seen_at DESC).
  async function seedAlert(fields: {
    alert_type: string;
    summary: string;
    last_seen_at: string;
    severity?: string;
    resolved_at?: string | null;
  }): Promise<string> {
    const db = createTestSupabaseClient();
    const { data, error } = await db
      .from('platform_alerts')
      .insert({
        alert_type: fields.alert_type,
        severity: fields.severity ?? 'critical',
        summary: fields.summary,
        details: {},
        last_seen_at: fields.last_seen_at,
        resolved_at: fields.resolved_at ?? null,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    const id = (data as { id: string }).id;
    seededIds.push(id);
    return id;
  }

  it('GET returns 401 without a token', async () => {
    const { status } = await callRoute(GET, { method: 'GET', url: BASE });
    expect(status).toBe(401);
  });

  it('GET rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: BASE,
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('GET lists open alerts newest-first and filters by status', async () => {
    admin = await withPlatformAdmin();
    const suffix = String(Date.now());
    const older = await seedAlert({ alert_type: `t_old_${suffix}`, summary: 'older open', last_seen_at: '2099-01-01T00:00:00Z' });
    const newer = await seedAlert({ alert_type: `t_new_${suffix}`, summary: 'newer open', last_seen_at: '2099-02-01T00:00:00Z' });
    const resolved = await seedAlert({
      alert_type: `t_res_${suffix}`,
      summary: 'resolved one',
      last_seen_at: '2099-03-01T00:00:00Z',
      resolved_at: '2099-03-02T00:00:00Z',
    });

    // Default status=open: excludes the resolved one; our seeds sort newest-first.
    const { status, body } = await callRoute<AlertsResponse>(GET, {
      method: 'GET',
      url: BASE,
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(200);
    const openIds = body.alerts.map((a) => a.id);
    expect(openIds).toContain(newer);
    expect(openIds).toContain(older);
    expect(openIds).not.toContain(resolved);
    expect(openIds.indexOf(newer)).toBeLessThan(openIds.indexOf(older));

    // status=resolved: includes the resolved one, excludes the open ones.
    const res = await callRoute<AlertsResponse>(GET, {
      method: 'GET',
      url: `${BASE}?status=resolved`,
      headers: bearerHeader(admin.accessToken),
    });
    const resIds = res.body.alerts.map((a) => a.id);
    expect(resIds).toContain(resolved);
    expect(resIds).not.toContain(newer);
  });

  it('PATCH resolves then reopens an alert', async () => {
    admin = await withPlatformAdmin();
    const id = await seedAlert({ alert_type: `t_patch_${Date.now()}`, summary: 'to resolve', last_seen_at: '2099-01-01T00:00:00Z' });
    const db = createTestSupabaseClient();

    const resolve = await callRoute<{ ok: boolean }>(patchHandler(id), {
      method: 'PATCH',
      body: { resolved: true },
      headers: bearerHeader(admin.accessToken),
    });
    expect(resolve.status).toBe(200);
    const { data: afterResolve } = await db.from('platform_alerts').select('resolved_at').eq('id', id).single();
    expect((afterResolve as { resolved_at: string | null }).resolved_at).not.toBeNull();

    const reopen = await callRoute<{ ok: boolean }>(patchHandler(id), {
      method: 'PATCH',
      body: { resolved: false },
      headers: bearerHeader(admin.accessToken),
    });
    expect(reopen.status).toBe(200);
    const { data: afterReopen } = await db.from('platform_alerts').select('resolved_at').eq('id', id).single();
    expect((afterReopen as { resolved_at: string | null }).resolved_at).toBeNull();
  });

  it('PATCH validates the body, id, and caller', async () => {
    admin = await withPlatformAdmin();
    const id = await seedAlert({ alert_type: `t_bad_${Date.now()}`, summary: 'x', last_seen_at: '2099-01-01T00:00:00Z' });

    const bad = await callRoute(patchHandler(id), {
      method: 'PATCH',
      body: { resolved: 'yes' },
      headers: bearerHeader(admin.accessToken),
    });
    expect(bad.status).toBe(400);

    const missing = await callRoute(patchHandler('00000000-0000-0000-0000-000000000000'), {
      method: 'PATCH',
      body: { resolved: true },
      headers: bearerHeader(admin.accessToken),
    });
    expect(missing.status).toBe(404);

    org = await withTestOrg();
    const forbidden = await callRoute(patchHandler(id), {
      method: 'PATCH',
      body: { resolved: true },
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(forbidden.status).toBe(403);
  });

  // T1-14 route lows: caller mistakes must be 400s, never unhandled 500s or silently-broadened
  // reads.
  it('PATCH 400s on a literal null JSON body (previously threw reading body.resolved)', async () => {
    admin = await withPlatformAdmin();
    const id = await seedAlert({ alert_type: `t_null_${Date.now()}`, summary: 'x', last_seen_at: '2099-01-01T00:00:00Z' });
    const { status } = await callRoute(patchHandler(id), {
      method: 'PATCH',
      body: null as unknown as Record<string, unknown>,
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(400);
  });

  it('PATCH 400s on a non-UUID id (previously a Postgres cast 500)', async () => {
    admin = await withPlatformAdmin();
    const { status } = await callRoute(patchHandler('not-a-uuid'), {
      method: 'PATCH',
      body: { resolved: true },
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(400);
  });

  it('GET 400s on an unknown ?status= (previously silently returned ALL alerts)', async () => {
    admin = await withPlatformAdmin();
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: `${BASE}?status=everything`,
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(400);
  });
});
