import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';

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

describe('POST /api/payments/record manager gate (can_manage_payments)', () => {
  let mgrOrg: TestOrgFixture | null = null;
  let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

  afterEach(async () => {
    if (mgr) { await mgr.cleanup(); mgr = null; }
    if (mgrOrg) { await mgrOrg.cleanup(); mgrOrg = null; }
  });

  it('403 for a manager without can_manage_payments', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: false });
    const res = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: mgrOrg.organizationId, appointment_id: crypto.randomUUID(), amount: 100, payment_method: 'card' },
    });
    expect(res.status).toBe(403);
  });

  it('lets a manager WITH can_manage_payments past the auth gate', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: true });
    const res = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: mgrOrg.organizationId, appointment_id: crypto.randomUUID(), amount: 100, payment_method: 'card' },
    });
    // Past auth: not a 401/403. (May 400/404/500 on the fake appointment id — that's fine, we only assert the gate.)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
