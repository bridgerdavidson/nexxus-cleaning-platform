import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';

describe('POST /api/payments/record', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let appointmentInOrg1: { id: string };

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
    appointmentInOrg1 = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects mismatch between body.organization_id and appointment.organization_id (proves the bug)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: {
        organization_id: org2.organizationId,
        appointment_id: appointmentInOrg1.id,
        amount: 100,
        payment_method: 'manual',
      },
    });
    // 400 (org mismatch) or 404 (not found in caller's org) both acceptable.
    expect([400, 404]).toContain(status);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: {
        organization_id: org.organizationId,
        amount: 100,
        payment_method: 'manual',
      },
    });
    expect(status).toBe(401);
  });

  it('records a payment for an appointment', async () => {
    const { status, body } = await callRoute<{ success: boolean; payment: { id: string }; error?: string; details?: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        organization_id: org.organizationId,
        appointment_id: appointmentInOrg1.id,
        amount: 200,
        payment_method: 'manual',
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.payment.id).toBeTruthy();
  });

  it('rejects non-admin caller (e.g. cleaner)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: {
        organization_id: org.organizationId,
        amount: 50,
        payment_method: 'manual',
      },
    });
    expect(status).toBe(403);
  });
});
