import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST, GET } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  addManagerToOrg,
  type TestOrgFixture,
  type ManagerMemberHandle,
} from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

/**
 * Security audit C3/F-CORE-2: both POST and GET were fully unauthenticated. POST mass-
 * created series + appointment rows from client-supplied data; GET leaked homeowner PII
 * for any organizationId. Both now require org staff (requireOrgAuth).
 */
describe('/api/recurring-appointments (auth)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  const baseBody = (orgId: string, homeownerId: string, propertyId: string, serviceTypeId: string) => ({
    organizationId: orgId,
    homeownerId,
    propertyId,
    serviceTypeId,
    startDate: '2026-07-01',
    startTime: '10:00',
    durationMinutes: 60,
    totalPrice: 100,
    recurrenceType: 'weekly',
    interval: 1,
    daysOfWeek: [3],
    maxOccurrences: 2,
  });

  it('POST returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organizationId: org.organizationId, homeownerId: org.homeowner.userId, propertyId: 'x', serviceTypeId: 'y' },
    });
    expect(status).toBe(401);
  });

  it('POST rejects a cleaner (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, homeownerId: org.homeowner.userId, propertyId: 'x', serviceTypeId: 'y' },
    });
    expect(status).toBe(403);
  });

  it('POST rejects an admin from another org (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organizationId: org.organizationId, homeownerId: org.homeowner.userId, propertyId: 'x', serviceTypeId: 'y' },
    });
    expect(status).toBe(403);
  });

  it('POST succeeds for an org admin and creates appointments', async () => {
    // Reuse the property + service_type that createTestAppointment seeds for this org.
    const { propertyId, serviceTypeId } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const { status, body } = await callRoute<{ success: boolean; data: { appointmentsCreated: number } }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: baseBody(org.organizationId, org.homeowner.userId, propertyId, serviceTypeId),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.appointmentsCreated).toBeGreaterThan(0);
  });

  describe('minimum job price ($1)', () => {
    it('POST 400s a series priced under $1 and creates neither a series nor appointments', async () => {
      const { propertyId, serviceTypeId } = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
      });

      for (const totalPrice of [0, 0.5, null]) {
        const { status, body } = await callRoute<{ success: boolean; error: string }>(POST, {
          method: 'POST',
          headers: bearerHeader(org.admin.accessToken),
          body: { ...baseBody(org.organizationId, org.homeowner.userId, propertyId, serviceTypeId), totalPrice },
        });
        expect(status).toBe(400);
        expect(body).toMatchObject({ success: false, error: 'Price must be at least $1.' });
      }

      const db = createTestSupabaseClient();
      const { data: series } = await db
        .from('recurring_appointment_series')
        .select('id')
        .eq('organization_id', org.organizationId);
      expect(series ?? []).toHaveLength(0);
      const { data: generated } = await db
        .from('appointments')
        .select('id')
        .eq('organization_id', org.organizationId)
        .not('series_id', 'is', null);
      expect(generated ?? []).toHaveLength(0);
    });

    it('POST 400s an override under $1 even when the service itself is priced', async () => {
      const { propertyId, serviceTypeId } = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
      });
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: {
          ...baseBody(org.organizationId, org.homeowner.userId, propertyId, serviceTypeId),
          totalPrice: 0.5,
          priceOverrideEnabled: true,
          priceOverrideTotal: 0.5,
        },
      });
      expect(status).toBe(400);
    });

    it('POST succeeds at exactly $1 and prices every occurrence at $1', async () => {
      const { propertyId, serviceTypeId } = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
      });
      const { status, body } = await callRoute<{ success: boolean; data: { series: { id: string }; appointmentsCreated: number } }>(POST, {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { ...baseBody(org.organizationId, org.homeowner.userId, propertyId, serviceTypeId), totalPrice: 1 },
      });
      expect(status).toBe(200);
      expect(body.data.appointmentsCreated).toBe(2);

      const db = createTestSupabaseClient();
      const { data: occurrences } = await db
        .from('appointments')
        .select('total_price')
        .eq('series_id', body.data.series.id);
      expect((occurrences ?? []).map((o) => Number((o as { total_price: number }).total_price))).toEqual([1, 1]);
    });
  });

  it('GET returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: `http://localhost/api/recurring-appointments?organizationId=${org.organizationId}`,
    });
    expect(status).toBe(401);
  });

  it('GET rejects an admin from another org (403)', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org2.admin.accessToken),
      url: `http://localhost/api/recurring-appointments?organizationId=${org.organizationId}`,
    });
    expect(status).toBe(403);
  });

  it('GET succeeds for an org admin', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: `http://localhost/api/recurring-appointments?organizationId=${org.organizationId}`,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  // Manager permission gating (Task 5): POST needs can_edit_bookings, GET needs can_view_bookings.
  describe('manager permission gating', () => {
    let mgr: ManagerMemberHandle;

    afterEach(async () => {
      if (mgr) await mgr.cleanup();
    });

    it('POST 403s for a manager without can_edit_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: { organizationId: org.organizationId, homeownerId: org.homeowner.userId, propertyId: 'x', serviceTypeId: 'y' },
      });
      expect(status).toBe(403);
    });

    it('POST passes auth for a manager WITH can_edit_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
      const { propertyId, serviceTypeId } = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
      });
      const { status } = await callRoute<{ success: boolean; data: { appointmentsCreated: number } }>(POST, {
        method: 'POST',
        headers: bearerHeader(mgr.accessToken),
        body: baseBody(org.organizationId, org.homeowner.userId, propertyId, serviceTypeId),
      });
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
      expect(status).toBe(200);
    });

    it('GET 403s for a manager without can_view_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_view_bookings: false });
      const { status } = await callRoute(GET, {
        method: 'GET',
        headers: bearerHeader(mgr.accessToken),
        url: `http://localhost/api/recurring-appointments?organizationId=${org.organizationId}`,
      });
      expect(status).toBe(403);
    });

    it('GET passes auth for a manager WITH can_view_bookings', async () => {
      mgr = await addManagerToOrg(org.organizationId, { can_view_bookings: true });
      const { status, body } = await callRoute<{ success: boolean }>(GET, {
        method: 'GET',
        headers: bearerHeader(mgr.accessToken),
        url: `http://localhost/api/recurring-appointments?organizationId=${org.organizationId}`,
      });
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });
});
