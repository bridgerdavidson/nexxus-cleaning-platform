import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST, GET } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../tests/helpers/fixtures';

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
});
