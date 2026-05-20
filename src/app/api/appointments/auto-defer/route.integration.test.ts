import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as autoDeferRoute } from './route';
import { POST as requestRoute } from '../request/route';
import { POST as assignRoute } from '../assign-cleaner/route';
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

describe('POST /api/appointments/auto-defer', () => {
  let org: TestOrgFixture;
  let appointmentId: string;

  beforeEach(async () => {
    org = await withTestOrg();
    const { propertyId, serviceTypeId } = await seed(org.organizationId, org.homeowner.userId);
    const { body } = await callRoute<{ appointmentId: string }>(requestRoute, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        organizationId: org.organizationId,
        propertyId,
        serviceTypeId,
        slots: [{ scheduled_date: '2026-09-01', scheduled_time: '10:00' }],
      },
    });
    appointmentId = body.appointmentId;
    await callRoute(assignRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { appointmentId, cleanerId: org.cleaner.userId, organizationId: org.organizationId },
    });
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('marks an expired pending routing_log row as expired and escalates when no other cleaner is available', async () => {
    const admin = createTestSupabaseClient();
    // Force the deadline into the past.
    await admin
      .from('appointment_routing_log')
      .update({ deadline_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('appointment_id', appointmentId);

    const { status, body } = await callRoute<{ success: boolean; processed: number }>(autoDeferRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.processed).toBeGreaterThan(0);

    const { data: log } = await admin
      .from('appointment_routing_log')
      .select('response')
      .eq('appointment_id', appointmentId);
    const responses = (log as Array<{ response: string }>).map((r) => r.response);
    expect(responses).toContain('expired');

    // The org only has one cleaner; chain advance escalates.
    const { data: appt } = await admin
      .from('appointments')
      .select('request_state, cleaner_id')
      .eq('id', appointmentId)
      .single();
    expect((appt as { request_state: string }).request_state).toBe('needs_admin_attention');
    expect((appt as { cleaner_id: string | null }).cleaner_id).toBeNull();
  });

  it('is idempotent: re-running after expiry does not regress state', async () => {
    const admin = createTestSupabaseClient();
    await admin
      .from('appointment_routing_log')
      .update({ deadline_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('appointment_id', appointmentId);
    await callRoute(autoDeferRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId },
    });
    const { body } = await callRoute<{ processed: number }>(autoDeferRoute, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId },
    });
    expect(body.processed).toBe(0);
  });
});
