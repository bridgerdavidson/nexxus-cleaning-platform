import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH, DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedService(orgId: string, name = 'Std') {
  const { data, error } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name, base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedAppointmentUsing(orgId: string, homeownerId: string, serviceId: string) {
  const { data: prop, error: propErr } = await db
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: homeownerId,
      name: 'Test Property',
      address: '1 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '00000',
    })
    .select('id')
    .single();
  if (propErr) throw propErr;
  const { error: apptErr } = await db.from('appointments').insert({
    organization_id: orgId,
    homeowner_id: homeownerId,
    cleaner_id: null,
    property_id: prop.id,
    service_type_id: serviceId,
    scheduled_date: '2026-06-01',
    scheduled_time: '10:00',
    duration_minutes: 60,
    total_price: 100,
    status: 'pending',
    is_self_pay: false,
  });
  if (apptErr) throw apptErr;
}

describe('/api/services/[id]', () => {
  let org: TestOrgFixture;
  let serviceId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    serviceId = await seedService(org.organizationId);
  });

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await db.from('appointments').delete().eq('organization_id', org.organizationId);
    await db.from('properties').delete().eq('organization_id', org.organizationId);
    await org.cleanup();
  });

  function patch(id: string, body: unknown, token?: string) {
    return callRoute<Body>(
      (req) => PATCH(req, { params: Promise.resolve({ id }) }),
      { method: 'PATCH', url: `http://test/api/services/${id}`, headers: token ? bearerHeader(token) : {}, body },
    );
  }
  function del(id: string, token?: string) {
    return callRoute<Body>(
      (req) => DELETE(req, { params: Promise.resolve({ id }) }),
      { method: 'DELETE', url: `http://test/api/services/${id}`, headers: token ? bearerHeader(token) : {} },
    );
  }

  describe('PATCH', () => {
    it('returns 404 for an unknown id and for a non-uuid id', async () => {
      expect((await patch(UNKNOWN_ID, { name: 'x' }, org.admin.accessToken)).status).toBe(404);
      expect((await patch('nope', { name: 'x' }, org.admin.accessToken)).status).toBe(404);
    });

    it('returns 401 without a token', async () => {
      expect((await patch(serviceId, { name: 'x' })).status).toBe(401);
    });

    it('returns 403 for a cleaner, a flagless manager, and another org\'s admin', async () => {
      const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
      cleanups.push(() => mgr.cleanup());
      const other = await withTestOrg();
      cleanups.push(() => other.cleanup());
      expect((await patch(serviceId, { name: 'x' }, org.cleaner.accessToken)).status).toBe(403);
      expect((await patch(serviceId, { name: 'x' }, mgr.accessToken)).status).toBe(403);
      expect((await patch(serviceId, { name: 'x' }, other.admin.accessToken)).status).toBe(403);
    });

    it('returns 400 when no valid fields are given', async () => {
      const res = await patch(serviceId, { unrelated: 1 }, org.admin.accessToken);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No valid fields to update');
    });

    it('admin updates a subset of fields and gets the full row back', async () => {
      const res = await patch(serviceId, { name: ' Standard ', is_active: false }, org.admin.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: serviceId, name: 'Standard', is_active: false, duration_minutes: 60 });
      const { data } = await db.from('service_types').select('name, is_active').eq('id', serviceId).single();
      expect(data).toEqual({ name: 'Standard', is_active: false });
    });

    it('manager with can_manage_services updates the service', async () => {
      const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
      cleanups.push(() => mgr.cleanup());
      const res = await patch(serviceId, { base_price: '125' }, mgr.accessToken);
      expect(res.status).toBe(200);
      expect(Number(res.body.data!.base_price)).toBe(125);
    });
  });

  describe('DELETE', () => {
    it('returns 404 for an unknown id', async () => {
      expect((await del(UNKNOWN_ID, org.admin.accessToken)).status).toBe(404);
    });

    it('returns 403 for a cleaner', async () => {
      expect((await del(serviceId, org.cleaner.accessToken)).status).toBe(403);
    });

    it('returns 409 when an appointment uses the service, and leaves it in place', async () => {
      await seedAppointmentUsing(org.organizationId, org.homeowner.userId, serviceId);
      const res = await del(serviceId, org.admin.accessToken);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(
        'Cannot delete service that is used in existing appointments. Consider disabling it instead.',
      );
      const { data } = await db.from('service_types').select('id').eq('id', serviceId);
      expect(data).toHaveLength(1);
    });

    it('admin deletes an unused service and its checklists go with it', async () => {
      const res = await del(serviceId, org.admin.accessToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const { data: svc } = await db.from('service_types').select('id').eq('id', serviceId);
      expect(svc).toEqual([]);
      const { data: cls } = await db.from('checklists').select('id').eq('service_type_id', serviceId);
      expect(cls).toEqual([]);
    });
  });
});
