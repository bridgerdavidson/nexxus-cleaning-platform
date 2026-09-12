import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();

describe('POST /api/services', () => {
  let org: TestOrgFixture;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  const validBody = () => ({
    organization_id: org.organizationId,
    name: 'Deep Clean',
    description: ' Full top to bottom ',
    base_price: 199.5,
    duration_minutes: 180,
    service_type: 'deep',
  });

  function post(body: unknown, token?: string) {
    return callRoute<Body>(POST, {
      method: 'POST',
      url: 'http://test/api/services',
      headers: token ? bearerHeader(token) : {},
      body,
    });
  }

  async function checklistsOf(serviceId: string) {
    const { data } = await db
      .from('checklists')
      .select('id, name, price_adder, position, checklist_line_items ( task, position )')
      .eq('service_type_id', serviceId)
      .order('price_adder', { ascending: true });
    return (data ?? []) as Array<{
      id: string;
      name: string;
      price_adder: number;
      position: number | null;
      checklist_line_items: Array<{ task: string; position: number | null }>;
    }>;
  }

  it('returns 401 without a token', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(401);
  });

  it('returns 400 on an invalid body', async () => {
    const res = await post({ ...validBody(), name: '' }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Service name is required');
  });

  it('returns 403 for a cleaner', async () => {
    const res = await post(validBody(), org.cleaner.accessToken);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a manager without can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const res = await post(validBody(), mgr.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Requires the Manage services permission');
  });

  it('returns 403 for an admin of a different organization', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    const res = await post(validBody(), other.admin.accessToken);
    expect(res.status).toBe(403);
  });

  it('admin creates the service and keeps the trigger-seeded default checklist', async () => {
    const res = await post(validBody(), org.admin.accessToken);
    expect(res.status).toBe(201);
    const data = res.body.data!;
    expect(data.organization_id).toBe(org.organizationId);
    expect(data.name).toBe('Deep Clean');
    expect(data.description).toBe('Full top to bottom');
    expect(Number(data.base_price)).toBe(199.5);
    expect(data.duration_minutes).toBe(180);
    expect(data.is_active).toBe(true);

    const cls = await checklistsOf(data.id as string);
    expect(cls).toHaveLength(1);
    expect(cls[0].name).toBe('Default Checklist');
    expect(cls[0].checklist_line_items.length).toBeGreaterThan(0);
  });

  it('manager with can_manage_services creates the service', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    const res = await post(validBody(), mgr.accessToken);
    expect(res.status).toBe(201);
  });

  it('a checklists array replaces the default checklist, items in order', async () => {
    const res = await post(
      {
        ...validBody(),
        checklists: [
          { name: 'Basic', price_adder: 0, items: ['Dust', ' Vacuum ', ''] },
          { name: 'Plus', price_adder: 25, position: 1, items: [] },
        ],
      },
      org.admin.accessToken,
    );
    expect(res.status).toBe(201);
    const cls = await checklistsOf(res.body.data!.id as string);
    expect(cls.map((c) => c.name)).toEqual(['Basic', 'Plus']);
    expect(cls[1].position).toBe(1);
    const basicItems = [...cls[0].checklist_line_items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    expect(basicItems).toEqual([
      { task: 'Dust', position: 0 },
      { task: 'Vacuum', position: 1 },
    ]);
    expect(cls[1].checklist_line_items).toEqual([]);
  });

  it('an empty checklists array leaves the service with no checklists', async () => {
    const res = await post({ ...validBody(), checklists: [] }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(await checklistsOf(res.body.data!.id as string)).toEqual([]);
  });

  it('deletes the service again when a checklist seed fails', async () => {
    // checklists.price_adder is numeric(10,2); 1e9 overflows it and the insert fails.
    const res = await post(
      { ...validBody(), name: 'Rollback Me', checklists: [{ name: 'Bad', price_adder: 1e9, items: [] }] },
      org.admin.accessToken,
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/numeric field overflow/);
    const { data } = await db
      .from('service_types')
      .select('id')
      .eq('organization_id', org.organizationId)
      .eq('name', 'Rollback Me');
    expect(data).toEqual([]);
  });
});
