import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/**
 * Seed a recurring series (one recurring_appointment_series row + N appointment
 * occurrences sharing its id) offered to the org's cleaner. Each occurrence is
 * pending + awaiting, mirroring what POST /api/recurring-appointments creates.
 */
async function seedSeries(
  org: TestOrgFixture,
  dates: string[],
): Promise<{ seriesId: string; appointmentIds: string[] }> {
  const admin = createTestSupabaseClient();
  const { data: prop } = await admin
    .from('properties')
    .insert({
      organization_id: org.organizationId,
      owner_id: org.homeowner.userId,
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
      organization_id: org.organizationId,
      name: 'Std',
      base_price: 120,
      duration_minutes: 120,
      service_type: 'regular',
    })
    .select('id')
    .single();
  const propertyId = (prop as { id: string }).id;
  const serviceTypeId = (svc as { id: string }).id;

  const { data: series, error: seriesErr } = await admin
    .from('recurring_appointment_series')
    .insert({
      organization_id: org.organizationId,
      homeowner_id: org.homeowner.userId,
      cleaner_id: org.cleaner.userId,
      property_id: propertyId,
      service_type_id: serviceTypeId,
      start_date: dates[0],
      start_time: '10:00',
      duration_minutes: 120,
      total_price: 120,
      recurrence_type: 'weekly',
      interval: 1,
      is_active: true,
    })
    .select('id')
    .single();
  if (seriesErr || !series) throw new Error(`series insert failed: ${seriesErr?.message}`);
  const seriesId = (series as { id: string }).id;

  const rows = dates.map((d) => ({
    organization_id: org.organizationId,
    homeowner_id: org.homeowner.userId,
    cleaner_id: org.cleaner.userId,
    property_id: propertyId,
    service_type_id: serviceTypeId,
    scheduled_date: d,
    scheduled_time: '10:00',
    duration_minutes: 120,
    total_price: 120,
    status: 'pending',
    series_id: seriesId,
    cleaner_confirmation_status: 'awaiting',
  }));
  const { data: appts, error: apptErr } = await admin.from('appointments').insert(rows).select('id');
  if (apptErr || !appts) throw new Error(`appointments insert failed: ${apptErr?.message}`);
  return { seriesId, appointmentIds: (appts as Array<{ id: string }>).map((a) => a.id) };
}

describe('POST /api/appointments/confirm-series', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects with no Authorization header → 401', async () => {
    const { seriesId } = await seedSeries(org, ['2026-10-01', '2026-10-08']);
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organizationId: org.organizationId, seriesId, action: 'accept' },
    });
    expect(status).toBe(401);
  });

  it('missing action → 400', async () => {
    const { seriesId } = await seedSeries(org, ['2026-10-01']);
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, seriesId },
    });
    expect(status).toBe(400);
  });

  it('decline without declineReason → 400', async () => {
    const { seriesId } = await seedSeries(org, ['2026-10-01']);
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, seriesId, action: 'decline' },
    });
    expect(status).toBe(400);
  });

  it('accept-all confirms every awaiting occurrence with dates intact', async () => {
    const { seriesId, appointmentIds } = await seedSeries(org, ['2026-10-01', '2026-10-08', '2026-10-15']);
    const { status, body } = await callRoute<{ success: boolean; total: number; succeeded: number; failed: number }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, seriesId, action: 'accept' },
    });
    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.succeeded).toBe(3);
    expect(body.failed).toBe(0);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('appointments')
      .select('id, scheduled_date, status, cleaner_confirmation_status')
      .in('id', appointmentIds)
      .order('scheduled_date', { ascending: true });
    const rows = data as Array<{ scheduled_date: string; status: string; cleaner_confirmation_status: string }>;
    expect(rows.map((r) => r.scheduled_date)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
    expect(rows.every((r) => r.status === 'confirmed')).toBe(true);
    expect(rows.every((r) => r.cleaner_confirmation_status === 'approved')).toBe(true);
  });

  it('decline-all routes every occurrence away from the cleaner (single-cleaner org escalates)', async () => {
    const { seriesId, appointmentIds } = await seedSeries(org, ['2026-11-01', '2026-11-08']);
    const { status, body } = await callRoute<{ succeeded: number; failed: number; total: number }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, seriesId, action: 'decline', declineReason: 'sick' },
    });
    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(2);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('appointments')
      .select('id, cleaner_id')
      .in('id', appointmentIds);
    // Only one cleaner in the org → the chain escalates → cleaner_id cleared.
    expect((data as Array<{ cleaner_id: string | null }>).every((r) => r.cleaner_id === null)).toBe(true);

    const { data: fb } = await admin
      .from('cleaner_availability_feedback')
      .select('appointment_id, reason')
      .in('appointment_id', appointmentIds);
    expect((fb as Array<{ reason: string }>).length).toBe(2);
    expect((fb as Array<{ reason: string }>).every((f) => f.reason === 'Sick')).toBe(true);
  });

  it('only the caller-cleaner awaiting occurrences are processed (already-approved is left alone)', async () => {
    const { seriesId, appointmentIds } = await seedSeries(org, ['2026-12-01', '2026-12-08', '2026-12-15']);
    const admin = createTestSupabaseClient();
    // Pre-approve the first occurrence so it is no longer awaiting.
    await admin
      .from('appointments')
      .update({ cleaner_confirmation_status: 'approved', status: 'confirmed' })
      .eq('id', appointmentIds[0]);

    const { body } = await callRoute<{ total: number; succeeded: number }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, seriesId, action: 'accept' },
    });
    // Only the two still-awaiting occurrences are in scope.
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(2);
    void seriesId;
  });

  it('a cleaner from another org cannot touch this org series (org auth refuses) ', async () => {
    const { seriesId } = await seedSeries(org, ['2027-01-01', '2027-01-08']);
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.cleaner.accessToken),
      body: { organizationId: org.organizationId, seriesId, action: 'accept' },
    });
    expect([403, 404]).toContain(status);
  });
});
