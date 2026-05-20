import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as assignRoute } from './route';
import { POST as requestRoute } from '../request/route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

async function seed(orgId: string, ownerId: string) {
  const admin = createTestSupabaseClient();
  const { data: prop } = await admin
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: ownerId,
      name: 'P',
      address: '1 Lane',
      city: 'C',
      state: 'S',
      zip_code: '12345',
    })
    .select('id')
    .single();
  const { data: svc } = await admin
    .from('service_types')
    .insert({
      organization_id: orgId,
      name: 'Std',
      base_price: 200,
      duration_minutes: 90,
      service_type: 'regular',
    })
    .select('id')
    .single();
  return { propertyId: (prop as { id: string }).id, serviceTypeId: (svc as { id: string }).id };
}

async function createRequest(
  orgId: string,
  token: string,
  propertyId: string,
  serviceTypeId: string,
): Promise<string> {
  const { body } = await callRoute<{ appointmentId: string }>(requestRoute, {
    method: 'POST',
    headers: bearerHeader(token),
    body: {
      organizationId: orgId,
      propertyId,
      serviceTypeId,
      slots: [{ scheduled_date: '2026-08-01', scheduled_time: '10:00' }],
    },
  });
  return body.appointmentId;
}

describe('POST /api/appointments/assign-cleaner', () => {
  let org: TestOrgFixture;
  let propertyId: string;
  let serviceTypeId: string;
  let appointmentId: string;

  beforeEach(async () => {
    org = await withTestOrg();
    ({ propertyId, serviceTypeId } = await seed(org.organizationId, org.homeowner.userId));
    appointmentId = await createRequest(org.organizationId, org.homeowner.accessToken, propertyId, serviceTypeId);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('admin assigns a cleaner; routing_log row is inserted', async () => {
    const { status, body } = await callRoute<{ success: boolean; attemptIndex: number }>(assignRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId,
        cleanerId: org.cleaner.userId,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.attemptIndex).toBe(1);

    const admin = createTestSupabaseClient();
    const { data: log } = await admin
      .from('appointment_routing_log')
      .select('cleaner_id, attempt_index, response')
      .eq('appointment_id', appointmentId);
    expect(log).toHaveLength(1);
    expect((log as Array<{ cleaner_id: string }>)[0].cleaner_id).toBe(org.cleaner.userId);

    const { data: appt } = await admin
      .from('appointments')
      .select('cleaner_id, request_state, cleaner_confirmation_status, response_deadline')
      .eq('id', appointmentId)
      .single();
    expect((appt as { cleaner_id: string }).cleaner_id).toBe(org.cleaner.userId);
    expect((appt as { request_state: string }).request_state).toBe('routing');
    expect((appt as { cleaner_confirmation_status: string }).cleaner_confirmation_status).toBe('awaiting');
    expect((appt as { response_deadline: string | null }).response_deadline).toBeTruthy();
  });

  it('rejects double-assign when a pending routing_log row exists', async () => {
    await callRoute(assignRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId,
        cleanerId: org.cleaner.userId,
        organizationId: org.organizationId,
      },
    });
    const { status } = await callRoute(assignRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId,
        cleanerId: org.cleaner.userId,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(409);
  });

  it('homeowner cannot call assign-cleaner', async () => {
    const { status } = await callRoute(assignRoute, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        appointmentId,
        cleanerId: org.cleaner.userId,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(403);
  });

  it('rejects when cleaner belongs to a different org', async () => {
    const otherOrg = await withTestOrg();
    const { status } = await callRoute(assignRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointmentId,
        cleanerId: otherOrg.cleaner.userId,
        organizationId: org.organizationId,
      },
    });
    expect(status).toBe(400);
    await otherOrg.cleanup();
  });
});
