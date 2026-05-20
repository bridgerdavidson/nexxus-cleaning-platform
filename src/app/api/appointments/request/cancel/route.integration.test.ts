import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as cancelRoute } from './route';
import { POST as requestRoute } from '../route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

async function seedPropertyAndService(orgId: string, ownerId: string) {
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
      slots: [{ scheduled_date: '2026-07-15', scheduled_time: '09:00' }],
    },
  });
  return body.appointmentId;
}

describe('POST /api/appointments/request/cancel', () => {
  let org: TestOrgFixture;
  let propertyId: string;
  let serviceTypeId: string;
  let appointmentId: string;

  beforeEach(async () => {
    org = await withTestOrg();
    ({ propertyId, serviceTypeId } = await seedPropertyAndService(org.organizationId, org.homeowner.userId));
    appointmentId = await createRequest(org.organizationId, org.homeowner.accessToken, propertyId, serviceTypeId);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('homeowner cancels their own pending request', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(cancelRoute, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { appointmentId, organizationId: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('appointments')
      .select('status, request_state')
      .eq('id', appointmentId)
      .single();
    expect((data as { status: string; request_state: string | null }).status).toBe('cancelled');
    // Clearing request_state drops the row out of pending-request queries so
    // admins don't try to route a cancelled request.
    expect((data as { status: string; request_state: string | null }).request_state).toBeNull();
  });

  it('admin can cancel a homeowner request in their org', async () => {
    const { status } = await callRoute(cancelRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { appointmentId, organizationId: org.organizationId },
    });
    expect(status).toBe(200);
  });

  it('cleaner cannot cancel a request', async () => {
    const { status } = await callRoute(cancelRoute, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { appointmentId, organizationId: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('rejects cancel of a completed request', async () => {
    const admin = createTestSupabaseClient();
    await admin
      .from('appointments')
      .update({ status: 'confirmed', request_state: 'completed' })
      .eq('id', appointmentId);
    const { status } = await callRoute(cancelRoute, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { appointmentId, organizationId: org.organizationId },
    });
    expect(status).toBe(400);
  });
});
