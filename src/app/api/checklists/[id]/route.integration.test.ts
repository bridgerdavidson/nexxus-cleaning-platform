import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH, DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedChecklist(orgId: string) {
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
  const { error: itemErr } = await db
    .from('checklist_line_items')
    .insert([{ checklist_id: cl.id, task: 'Dust', position: 0 }]);
  if (itemErr) throw itemErr;
  return cl.id as string;
}

describe('/api/checklists/[id]', () => {
  let org: TestOrgFixture;
  let checklistId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    checklistId = await seedChecklist(org.organizationId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  const patch = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => PATCH(req, { params: Promise.resolve({ id }) }), {
      method: 'PATCH', url: `http://test/api/checklists/${id}`, headers: token ? bearerHeader(token) : {}, body,
    });
  const del = (id: string, token?: string) =>
    callRoute<Body>((req) => DELETE(req, { params: Promise.resolve({ id }) }), {
      method: 'DELETE', url: `http://test/api/checklists/${id}`, headers: token ? bearerHeader(token) : {},
    });

  it('PATCH returns 404 for an unknown checklist and 401 without a token', async () => {
    expect((await patch(UNKNOWN_ID, { name: 'x' }, org.admin.accessToken)).status).toBe(404);
    expect((await patch(checklistId, { name: 'x' })).status).toBe(401);
  });

  it('PATCH returns 403 for a cleaner and for another org\'s admin', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await patch(checklistId, { name: 'x' }, org.cleaner.accessToken)).status).toBe(403);
    expect((await patch(checklistId, { name: 'x' }, other.admin.accessToken)).status).toBe(403);
  });

  it('PATCH returns 404 for a malformed id', async () => {
    expect((await patch('not-a-uuid', { name: 'x' }, org.admin.accessToken)).status).toBe(404);
  });

  it('PATCH returns 403 for a manager without can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const res = await patch(checklistId, { name: 'x' }, mgr.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Requires the Manage services permission');
  });

  it('PATCH returns 200 for a manager with can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    const res = await patch(checklistId, { name: 'Mgr Update' }, mgr.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: checklistId, name: 'Mgr Update' });
  });

  it('PATCH returns 400 for a blank name', async () => {
    const res = await patch(checklistId, { name: '  ' }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Checklist name cannot be empty');
  });

  it('PATCH updates name and price and returns the row', async () => {
    const res = await patch(checklistId, { name: ' Deluxe ', price_adder: '40' }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: checklistId, name: 'Deluxe' });
    expect(Number(res.body.data!.price_adder)).toBe(40);
  });

  it('DELETE returns 403 for a cleaner', async () => {
    expect((await del(checklistId, org.cleaner.accessToken)).status).toBe(403);
  });

  it('DELETE removes the checklist and its items', async () => {
    const res = await del(checklistId, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const { data: cl } = await db.from('checklists').select('id').eq('id', checklistId);
    expect(cl).toEqual([]);
    const { data: items } = await db.from('checklist_line_items').select('id').eq('checklist_id', checklistId);
    expect(items).toEqual([]);
  });
});
