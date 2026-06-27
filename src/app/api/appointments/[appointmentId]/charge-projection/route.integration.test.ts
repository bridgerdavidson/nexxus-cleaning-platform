import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';
import { projectCompletionCharge } from '@/lib/payments/projectCompletionCharge';

// Wrap the route handler the same way the charge route test does (passing
// appointmentId through params while the request carries organization_id in
// its search params).
const handlerFor =
  (appointmentId: string) =>
  (req: NextRequest) =>
    GET(req, { params: Promise.resolve({ appointmentId }) });

function urlFor(apptId: string, orgId: string) {
  return `http://test.local/api/appointments/${apptId}/charge-projection?organization_id=${orgId}`;
}

describe('GET /api/appointments/:appointmentId/charge-projection', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    // payoutPercent=40 on the cleaner so we can assert exact numbers.
    org = await withTestOrg({ payoutPercent: 40 });
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function seedAppt(opts: {
    totalPrice?: number;
    selfPay?: boolean;
  } = {}): Promise<string> {
    const { id } = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: opts.totalPrice ?? 120,
      status: 'completed',
      selfPay: opts.selfPay,
      orgOwnedProperty: opts.selfPay,
    });
    return id;
  }

  // --- (a) assigned cleaner gets a correct projection for a card appointment ---

  it('assigned cleaner receives a card projection matching projectCompletionCharge', async () => {
    const totalPrice = 150; // dollars
    const apptId = await seedAppt({ totalPrice });

    const { status, body } = await callRoute<{ projection: ReturnType<typeof projectCompletionCharge> }>(
      handlerFor(apptId),
      {
        method: 'GET',
        url: urlFor(apptId, org.organizationId),
        headers: bearerHeader(org.cleaner.accessToken),
      },
    );

    expect(status).toBe(200);
    const expected = projectCompletionCharge({
      baseCents: totalPrice * 100,
      method: 'card',
      isSelfPay: false,
      payoutPercent: 40,
      platformFeeBps: 0,
    });
    expect(body.projection).toMatchObject(expected);
  });

  it('org admin receives the same projection as the cleaner', async () => {
    const totalPrice = 200;
    const apptId = await seedAppt({ totalPrice });

    const { status, body } = await callRoute<{ projection: ReturnType<typeof projectCompletionCharge> }>(
      handlerFor(apptId),
      {
        method: 'GET',
        url: urlFor(apptId, org.organizationId),
        headers: bearerHeader(org.admin.accessToken),
      },
    );

    expect(status).toBe(200);
    const expected = projectCompletionCharge({
      baseCents: totalPrice * 100,
      method: 'card',
      isSelfPay: false,
      payoutPercent: 40,
      platformFeeBps: 0,
    });
    expect(body.projection).toMatchObject(expected);
  });

  it('projection for a self-pay appointment uses isSelfPay=true math', async () => {
    const totalPrice = 120;
    const apptId = await seedAppt({ totalPrice, selfPay: true });

    const { status, body } = await callRoute<{ projection: ReturnType<typeof projectCompletionCharge> }>(
      handlerFor(apptId),
      {
        method: 'GET',
        url: urlFor(apptId, org.organizationId),
        headers: bearerHeader(org.admin.accessToken),
      },
    );

    expect(status).toBe(200);
    const expected = projectCompletionCharge({
      baseCents: totalPrice * 100,
      method: 'card',
      isSelfPay: true,
      payoutPercent: 40,
      platformFeeBps: 0,
    });
    expect(body.projection).toMatchObject(expected);
    expect(body.projection.isSelfPay).toBe(true);
  });

  it('403 when a manager WITHOUT can_manage_payments requests a self-pay projection', async () => {
    const apptId = await seedAppt({ selfPay: true });
    const db = createTestSupabaseClient();
    // Convert the homeowner member into a manager without the Manage Payments permission,
    // mirroring the charge route's self-pay manager fence test.
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: false,
    });

    const { status, body } = await callRoute<{ error: string }>(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.homeowner.accessToken),
    });

    expect(status).toBe(403);
    expect(body.error).toBe('Requires the Manage Payments permission');
  });

  // --- (b) non-members and unassigned cleaners are rejected ---

  it('403 for a cleaner not assigned to the appointment', async () => {
    const apptId = await seedAppt();
    const db = createTestSupabaseClient();
    // Unassign the cleaner so the bearer user no longer owns the appointment.
    await db.from('appointments').update({ cleaner_id: null }).eq('id', apptId);

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });

    expect(status).toBe(403);
  });

  it('403 for a user who is not a member of the organization', async () => {
    const other = await withTestOrg();
    const apptId = await seedAppt();

    try {
      const { status } = await callRoute(handlerFor(apptId), {
        method: 'GET',
        url: urlFor(apptId, org.organizationId),
        // other org's admin is not a member of `org`
        headers: bearerHeader(other.admin.accessToken),
      });

      expect(status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  // --- (c) flag off -> 404 ---

  it('404 when STRIPE_NEW_CHARGE_FLOW_ENABLED is off', async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const apptId = await seedAppt();

    const { status } = await callRoute(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.admin.accessToken),
    });

    expect(status).toBe(404);
  });
});
