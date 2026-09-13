import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

type Item = { id: string; task: string; position: number | null; checklist_id: string };
type Body = { success?: boolean; data?: Item[]; error?: string };

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
  return cl.id as string;
}

describe('POST /api/checklists/[id]/items', () => {
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

  const post = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => POST(req, { params: Promise.resolve({ id }) }), {
      method: 'POST', url: `http://test/api/checklists/${id}/items`, headers: token ? bearerHeader(token) : {}, body,
    });

  it('returns 404, 401 and 403 as expected', async () => {
    expect((await post(UNKNOWN_ID, { task: 'x' }, org.admin.accessToken)).status).toBe(404);
    expect((await post(checklistId, { task: 'x' })).status).toBe(401);
    expect((await post(checklistId, { task: 'x' }, org.cleaner.accessToken)).status).toBe(403);
  });

  it('returns 404 for a malformed id', async () => {
    expect((await post('not-a-uuid', { task: 'x' }, org.admin.accessToken)).status).toBe(404);
  });

  it('returns 403 for a manager without can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const res = await post(checklistId, { task: 'x' }, mgr.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Requires the Manage services permission');
  });

  it('returns 201 for a manager with can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    const res = await post(checklistId, { task: 'Mgr Task' }, mgr.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data![0]).toMatchObject({ task: 'Mgr Task', checklist_id: checklistId });
  });

  it('returns 400 for a blank task and for an empty list', async () => {
    expect((await post(checklistId, { task: '  ' }, org.admin.accessToken)).body.error).toBe('Task cannot be empty');
    expect((await post(checklistId, { tasks: ['', ' '] }, org.admin.accessToken)).body.error).toBe('No tasks to add');
  });

  it('adds one task with position null', async () => {
    const res = await post(checklistId, { task: ' Dust ' }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data![0]).toMatchObject({ task: 'Dust', position: null, checklist_id: checklistId });
  });

  it('adds many tasks in the order given, all with position null', async () => {
    const res = await post(checklistId, { tasks: ['Dust', 'Mop', ' Vacuum '] }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data!.map((i) => i.task)).toEqual(['Dust', 'Mop', 'Vacuum']);
    expect(res.body.data!.every((i) => i.position === null)).toBe(true);
    const { count } = await db
      .from('checklist_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('checklist_id', checklistId);
    expect(count).toBe(3);
  });
});
