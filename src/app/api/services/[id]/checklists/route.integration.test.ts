import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

type Item = { id: string; task: string; position: number | null; checklist_id: string };
type Body = {
  success?: boolean;
  data?: { id: string; name: string; price_adder: number; service_type_id: string; checklist_line_items: Item[] };
  error?: string;
};

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedService(orgId: string) {
  const { data, error } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

describe('POST /api/services/[id]/checklists', () => {
  let org: TestOrgFixture;
  let serviceId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    serviceId = await seedService(org.organizationId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  function post(id: string, body: unknown, token?: string) {
    return callRoute<Body>(
      (req) => POST(req, { params: Promise.resolve({ id }) }),
      { method: 'POST', url: `http://test/api/services/${id}/checklists`, headers: token ? bearerHeader(token) : {}, body },
    );
  }

  it('returns 404 for an unknown service', async () => {
    expect((await post(UNKNOWN_ID, { name: 'x' }, org.admin.accessToken)).status).toBe(404);
  });
  it('returns 401 without a token', async () => {
    expect((await post(serviceId, { name: 'x' })).status).toBe(401);
  });
  it('returns 403 for a cleaner, a flagless manager, and another org\'s admin', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await post(serviceId, { name: 'x' }, org.cleaner.accessToken)).status).toBe(403);
    expect((await post(serviceId, { name: 'x' }, mgr.accessToken)).status).toBe(403);
    expect((await post(serviceId, { name: 'x' }, other.admin.accessToken)).status).toBe(403);
  });
  it('returns 400 on a bad price', async () => {
    const res = await post(serviceId, { name: 'x', price_adder: -1 }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Checklist price must be a number of 0 or more');
  });

  it('admin creates a checklist with items in order and gets them back nested', async () => {
    const res = await post(serviceId, { name: ' Plus ', price_adder: 25, items: ['Dust', ' Mop ', ''] }, org.admin.accessToken);
    expect(res.status).toBe(201);
    const data = res.body.data!;
    expect(data).toMatchObject({ name: 'Plus', service_type_id: serviceId });
    expect(Number(data.price_adder)).toBe(25);
    expect(data.checklist_line_items.map((i) => [i.task, i.position])).toEqual([['Dust', 0], ['Mop', 1]]);
    const { data: rows } = await db.from('checklist_line_items').select('task').eq('checklist_id', data.id);
    expect(rows).toHaveLength(2);
  });

  it('a blank name becomes "New Checklist" and no items gives an empty array', async () => {
    const res = await post(serviceId, { name: '', price_adder: 0 }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'New Checklist', checklist_line_items: [] });
  });

  it('manager with can_manage_services creates a checklist', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    expect((await post(serviceId, { name: 'Mgr', price_adder: 0 }, mgr.accessToken)).status).toBe(201);
  });
});
