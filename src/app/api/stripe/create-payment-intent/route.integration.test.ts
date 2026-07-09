import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/stripe/create-payment-intent', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let appointmentInOrg1: { id: string };

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();

    // Give homeowner a stripe_customer_id so the route doesn't bail at the 400 branch.
    const admin = createTestSupabaseClient();
    await admin
      .from('user_profiles')
      .update({ stripe_customer_id: `cus_test_${org.homeowner.userId.slice(0, 6)}` })
      .eq('id', org.homeowner.userId);

    appointmentInOrg1 = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice: 150,
    });
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects org2 caller passing org1 appointment_id (proves the bug)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: {
        appointment_id: appointmentInOrg1.id,
        organization_id: org2.organizationId,
      },
    });
    expect(status).toBe(404);
  });

  it('returns 404 when STRIPE_ENABLED is false', async () => {
    const original = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'false';
    try {
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: {
          appointment_id: appointmentInOrg1.id,
          organization_id: org.organizationId,
        },
      });
      expect(status).toBe(404);
    } finally {
      process.env.STRIPE_ENABLED = original;
    }
  });

  it('creates a payment record on success', async () => {
    const { status, body } = await callRoute<{ success: boolean; payment_record: { id: string }; error?: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        appointment_id: appointmentInOrg1.id,
        organization_id: org.organizationId,
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data: payments } = await admin
      .from('payments')
      .select('id, status, amount')
      .eq('appointment_id', appointmentInOrg1.id);
    expect(payments).toHaveLength(1);
    expect((payments![0] as { status: string }).status).toBe('paid');
  });

  it('updates the existing payment record on retry (no duplicate)', async () => {
    const headers = bearerHeader(org.admin.accessToken);
    const body = { appointment_id: appointmentInOrg1.id, organization_id: org.organizationId };

    await callRoute(POST, { method: 'POST', headers, body });
    await callRoute(POST, { method: 'POST', headers, body });

    const admin = createTestSupabaseClient();
    const { data: payments } = await admin
      .from('payments')
      .select('id')
      .eq('appointment_id', appointmentInOrg1.id);
    expect(payments).toHaveLength(1);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { appointment_id: appointmentInOrg1.id, organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });
});

describe('POST /api/stripe/create-payment-intent manager gate (can_manage_payments)', () => {
  let mgrOrg: TestOrgFixture | null = null;
  let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

  afterEach(async () => {
    if (mgr) { await mgr.cleanup(); mgr = null; }
    if (mgrOrg) { await mgrOrg.cleanup(); mgrOrg = null; }
  });

  it('403 for a manager without can_manage_payments', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: false });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { appointment_id: crypto.randomUUID(), organization_id: mgrOrg.organizationId },
    });
    expect(status).toBe(403);
  });

  it('lets a manager WITH can_manage_payments past the auth gate', async () => {
    mgrOrg = await withTestOrg();
    mgr = await addManagerToOrg(mgrOrg.organizationId, { can_manage_payments: true });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { appointment_id: crypto.randomUUID(), organization_id: mgrOrg.organizationId },
    });
    // Past auth: not a 401/403. (Fake appointment id -> 404 from the scope lookup, which is fine.)
    expect(status).not.toBe(401);
    expect(status).not.toBe(403);
  });
});
