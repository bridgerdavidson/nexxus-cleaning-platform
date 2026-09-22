import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH, DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedItem(orgId: string) {
  const { data: svc, error: svcErr } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (svcErr) throw svcErr;
  const { data: cl, error: clErr } = await db
    .from('checklists')
    .insert({ service_type_id: svc.id, name: 'Basic', price_adder: 0 })
    .select('id')
    .single();
  if (clErr) throw clErr;
  const { data: item, error: itemErr } = await db
    .from('checklist_line_items')
    .insert({ checklist_id: cl.id, task: 'Dust', position: 0 })
    .select('id')
    .single();
  if (itemErr) throw itemErr;
  return item.id as string;
}

describe('/api/checklist-items/[itemId]', () => {
  let org: TestOrgFixture;
  let itemId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    itemId = await seedItem(org.organizationId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  const patch = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => PATCH(req, { params: Promise.resolve({ itemId: id }) }), {
      method: 'PATCH', url: `http://test/api/checklist-items/${id}`, headers: token ? bearerHeader(token) : {}, body,
    });
  const del = (id: string, token?: string) =>
    callRoute<Body>((req) => DELETE(req, { params: Promise.resolve({ itemId: id }) }), {
      method: 'DELETE', url: `http://test/api/checklist-items/${id}`, headers: token ? bearerHeader(token) : {},
    });

  it('PATCH returns 404 for an unknown item and 401 without a token', async () => {
    expect((await patch(UNKNOWN_ID, { task: 'x' }, org.admin.accessToken)).status).toBe(404);
    expect((await patch(itemId, { task: 'x' })).status).toBe(401);
  });

  it('PATCH returns 404 for a malformed id', async () => {
    expect((await patch('not-a-uuid', { task: 'x' }, org.admin.accessToken)).status).toBe(404);
  });

  it('PATCH returns 403 for a cleaner and for another org\'s admin', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await patch(itemId, { task: 'x' }, org.cleaner.accessToken)).status).toBe(403);
    expect((await patch(itemId, { task: 'x' }, other.admin.accessToken)).status).toBe(403);
  });

  it('PATCH returns 403 for a manager without can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const res = await patch(itemId, { task: 'x' }, mgr.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Requires the Manage services permission');
  });

  it('PATCH returns 200 for a manager with can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    const res = await patch(itemId, { task: 'Mgr Update' }, mgr.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: itemId, task: 'Mgr Update' });
  });

  it('PATCH returns 400 for a blank task', async () => {
    const res = await patch(itemId, { task: '' }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Task cannot be empty');
  });

  it('PATCH updates the task text', async () => {
    const res = await patch(itemId, { task: ' Dust shelves ' }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: itemId, task: 'Dust shelves' });
  });

  it('DELETE removes the item', async () => {
    const res = await del(itemId, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const { data } = await db.from('checklist_line_items').select('id').eq('id', itemId);
    expect(data).toEqual([]);
  });

  describe('billing enforcement', () => {
    afterEach(() => {
      delete process.env.BILLING_ENFORCEMENT_ENABLED;
    });

    it('PATCH returns 402 billing_frozen when the flag is on and the trial has expired', async () => {
      process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
      await db.from('organizations').update({
        comped_at: null,
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      }).eq('id', org.organizationId);

      const res = await patch(itemId, { task: 'x' }, org.admin.accessToken);
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('billing_frozen');
    });
  });
});
