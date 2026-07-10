import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

async function seedPropertyAndService(orgId: string, ownerId: string) {
  const admin = createTestSupabaseClient();
  const { data: prop } = await admin
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: ownerId,
      name: 'Test Property',
      address: '42 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '12345',
    })
    .select('id')
    .single();
  const { data: svc } = await admin
    .from('service_types')
    .insert({
      organization_id: orgId,
      name: 'Standard Cleaning',
      base_price: 200,
      duration_minutes: 90,
      service_type: 'regular',
    })
    .select('id')
    .single();
  return { propertyId: (prop as { id: string }).id, serviceTypeId: (svc as { id: string }).id };
}

describe('POST /api/appointments/request', () => {
  let org: TestOrgFixture;
  let propertyId: string;
  let serviceTypeId: string;

  beforeEach(async () => {
    org = await withTestOrg();
    ({ propertyId, serviceTypeId } = await seedPropertyAndService(org.organizationId, org.homeowner.userId));
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('creates a homeowner-initiated request with the given slots', async () => {
    const { status, body } = await callRoute<{ success: boolean; appointmentId: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        organizationId: org.organizationId,
        propertyId,
        serviceTypeId,
        slots: [
          { scheduled_date: '2026-07-01', scheduled_time: '09:00' },
          { scheduled_date: '2026-07-02', scheduled_time: '10:00' },
        ],
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.appointmentId).toBeTruthy();

    const admin = createTestSupabaseClient();
    const { data: appt } = await admin
      .from('appointments')
      .select('homeowner_initiated, request_state, status, cleaner_id, scheduled_date, scheduled_time')
      .eq('id', body.appointmentId)
      .single();
    expect((appt as { homeowner_initiated: boolean }).homeowner_initiated).toBe(true);
    expect((appt as { request_state: string }).request_state).toBe('awaiting_admin');
    expect((appt as { status: string }).status).toBe('pending');
    expect((appt as { cleaner_id: string | null }).cleaner_id).toBeNull();
    // Primary slot is mirrored onto the parent row (NOT NULL columns).
    expect((appt as { scheduled_date: string }).scheduled_date).toBe('2026-07-01');

    const { data: slots } = await admin
      .from('appointment_requested_slots')
      .select('slot_index, scheduled_date, scheduled_time')
      .eq('appointment_id', body.appointmentId)
      .order('slot_index', { ascending: true });
    expect(slots).toHaveLength(2);
    expect((slots as Array<{ slot_index: number }>)[0].slot_index).toBe(0);
    expect((slots as Array<{ slot_index: number }>)[1].slot_index).toBe(1);
  });

  it('includes the checklist price adder in total_price', async () => {
    const admin = createTestSupabaseClient();
    const { data: cl } = await admin
      .from('checklists')
      .insert({ service_type_id: serviceTypeId, name: 'Standard', price_adder: 20 })
      .select('id')
      .single();
    const { status, body } = await callRoute<{ success: boolean; appointmentId: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        organizationId: org.organizationId,
        propertyId,
        serviceTypeId,
        checklistId: (cl as { id: string }).id,
        slots: [{ scheduled_date: '2026-07-01', scheduled_time: '09:00' }],
      },
    });
    expect(status).toBe(200);
    const { data: appt } = await admin
      .from('appointments')
      .select('total_price, checklist_id')
      .eq('id', body.appointmentId)
      .single();
    // base_price 200 + adder 20
    expect((appt as { total_price: number }).total_price).toBe(220);
    expect((appt as { checklist_id: string }).checklist_id).toBe((cl as { id: string }).id);
  });

  it('rejects a property that does not belong to the homeowner', async () => {
    const otherOrg = await withTestOrg();
    const other = await seedPropertyAndService(otherOrg.organizationId, otherOrg.homeowner.userId);
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        organizationId: org.organizationId,
        propertyId: other.propertyId,
        serviceTypeId,
        slots: [{ scheduled_date: '2026-07-01', scheduled_time: '09:00' }],
      },
    });
    expect([403, 404]).toContain(status);
    await otherOrg.cleanup();
  });

  it('rejects a service type from a different organization', async () => {
    const otherOrg = await withTestOrg();
    const other = await seedPropertyAndService(otherOrg.organizationId, otherOrg.homeowner.userId);
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        organizationId: org.organizationId,
        propertyId,
        serviceTypeId: other.serviceTypeId,
        slots: [{ scheduled_date: '2026-07-01', scheduled_time: '09:00' }],
      },
    });
    expect(status).toBe(403);
    await otherOrg.cleanup();
  });

  it('rejects more than 3 slots', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        organizationId: org.organizationId,
        propertyId,
        serviceTypeId,
        slots: [
          { scheduled_date: '2026-07-01', scheduled_time: '09:00' },
          { scheduled_date: '2026-07-02', scheduled_time: '09:00' },
          { scheduled_date: '2026-07-03', scheduled_time: '09:00' },
          { scheduled_date: '2026-07-04', scheduled_time: '09:00' },
        ],
      },
    });
    expect(status).toBe(400);
  });

  it('rejects unauthenticated request', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: {
        organizationId: org.organizationId,
        propertyId,
        serviceTypeId,
        slots: [{ scheduled_date: '2026-07-01', scheduled_time: '09:00' }],
      },
    });
    expect(status).toBe(401);
  });
});
