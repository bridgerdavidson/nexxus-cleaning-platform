import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PUT } from './route';
import { callRoute, bearerHeader } from '../../../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';

type Item = { id: string; task: string; position: number | null };
type Body = { success?: boolean; data?: Item[]; error?: string };

const db = createTestSupabaseClient();
const FOREIGN_ID = '00000000-0000-4000-8000-000000000000';

async function seedChecklistWithItems(orgId: string) {
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
  const { data: items, error: itemErr } = await db
    .from('checklist_line_items')
    .insert([
      { checklist_id: cl.id, task: 'a', position: 0 },
      { checklist_id: cl.id, task: 'b', position: 1 },
      { checklist_id: cl.id, task: 'c', position: 2 },
    ])
    .select('id, task');
  if (itemErr) throw itemErr;
  const byTask = Object.fromEntries((items as Item[]).map((i) => [i.task, i.id])) as Record<string, string>;
  return { checklistId: cl.id as string, ids: byTask };
}

describe('PUT /api/checklists/[id]/items/order', () => {
  let org: TestOrgFixture;
  let checklistId: string;
  let ids: Record<string, string>;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    ({ checklistId, ids } = await seedChecklistWithItems(org.organizationId));
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  const put = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => PUT(req, { params: Promise.resolve({ id }) }), {
      method: 'PUT', url: `http://test/api/checklists/${id}/items/order`, headers: token ? bearerHeader(token) : {}, body,
    });

  it('returns 403 for a cleaner', async () => {
    expect((await put(checklistId, { item_ids: [ids.c, ids.a, ids.b] }, org.cleaner.accessToken)).status).toBe(403);
  });

  it('returns 404 for a malformed id', async () => {
    expect((await put('not-a-uuid', { item_ids: [ids.a, ids.b, ids.c] }, org.admin.accessToken)).status).toBe(404);
  });

  it('returns 403 for a manager without can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const res = await put(checklistId, { item_ids: [ids.c, ids.a, ids.b] }, mgr.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Requires the Manage services permission');
  });

  it('returns 200 for a manager with can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    const res = await put(checklistId, { item_ids: [ids.c, ids.a, ids.b] }, mgr.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data!.map((i) => [i.task, i.position])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
  });

  it('returns 400 when an item is missing, foreign, or duplicated', async () => {
    const mismatch = 'item_ids must list every task in this checklist exactly once';
    expect((await put(checklistId, { item_ids: [ids.a, ids.b] }, org.admin.accessToken)).body.error).toBe(mismatch);
    expect((await put(checklistId, { item_ids: [ids.a, ids.b, FOREIGN_ID] }, org.admin.accessToken)).body.error).toBe(mismatch);
    expect((await put(checklistId, { item_ids: [ids.a, ids.a, ids.b] }, org.admin.accessToken)).body.error).toBe(
      'item_ids must be a list of unique item ids',
    );
  });

  it('writes the new positions and returns the items in that order', async () => {
    const res = await put(checklistId, { item_ids: [ids.c, ids.a, ids.b] }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data!.map((i) => [i.task, i.position])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
    const { data } = await db
      .from('checklist_line_items')
      .select('task, position')
      .eq('checklist_id', checklistId)
      .order('position', { ascending: true });
    expect(data).toEqual([{ task: 'c', position: 0 }, { task: 'a', position: 1 }, { task: 'b', position: 2 }]);
  });
});
