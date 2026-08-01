import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';
import { projectCompletionCharge } from '@/lib/payments/projectCompletionCharge';
import { stripeFeePassthroughEnabled } from '@/lib/stripe/flags';

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
    // Pinned to 0: the expected projections below hardcode platformFeeBps 0, and the DB
    // default became 100 in migration 111.
    org = await withTestOrg({ payoutPercent: 40, platformFeeBps: 0 });
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
      feePassthrough: stripeFeePassthroughEnabled(),
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
      feePassthrough: stripeFeePassthroughEnabled(),
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
      feePassthrough: stripeFeePassthroughEnabled(),
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

  // --- payout_only display: the cleaner must NOT receive the customer charge ---

  it("payout_only org: assigned cleaner gets display='payout_only' with NO customer charge", async () => {
    const totalPrice = 150;
    const apptId = await seedAppt({ totalPrice });
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ cleaner_pay_display: 'payout_only' })
      .eq('id', org.organizationId);

    const { status, body } = await callRoute<{
      projection: {
        display: string;
        cleanerCutCents: number;
        chargeCents?: number;
        feeCents?: number;
        baseCents?: number;
        payoutPercent?: number;
      };
    }>(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });

    expect(status).toBe(200);
    expect(body.projection.display).toBe('payout_only');
    // The cut is still present so the cleaner sees what they earn.
    const full = projectCompletionCharge({
      baseCents: totalPrice * 100,
      method: 'card',
      isSelfPay: false,
      payoutPercent: 40,
      platformFeeBps: 0,
      feePassthrough: stripeFeePassthroughEnabled(),
    });
    expect(body.projection.cleanerCutCents).toBe(full.cleanerCutCents);
    // PRIVACY: the customer charge + percentage are omitted from the payload entirely.
    expect(body.projection.chargeCents).toBeUndefined();
    expect(body.projection.feeCents).toBeUndefined();
    expect(body.projection.baseCents).toBeUndefined();
    expect(body.projection.payoutPercent).toBeUndefined();
  });

  it("payout_only org: org admin still gets display='full' with the customer charge", async () => {
    const totalPrice = 200;
    const apptId = await seedAppt({ totalPrice });
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ cleaner_pay_display: 'payout_only' })
      .eq('id', org.organizationId);

    const { status, body } = await callRoute<{
      projection: { display: string; chargeCents?: number; payoutPercent?: number };
    }>(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.admin.accessToken),
    });

    expect(status).toBe(200);
    expect(body.projection.display).toBe('full');
    expect(body.projection.chargeCents).toBeDefined();
    expect(body.projection.payoutPercent).toBeDefined();
  });

  // --- pay mode: request-mode cleaners name their own amount ---

  it("request-mode cleaner gets payoutModel:'request' and NO cut (the percent is not their pay)", async () => {
    const apptId = await seedAppt({ totalPrice: 150 });
    const db = createTestSupabaseClient();
    await db
      .from('cleaner_profiles')
      .update({ payout_model: 'request' })
      .eq('id', org.cleaner.userId);

    const { status, body } = await callRoute<{
      projection: { payoutModel: string; cleanerCutCents?: number; chargeCents?: number };
    }>(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });

    expect(status).toBe(200);
    expect(body.projection.payoutModel).toBe('request');
    // Stating a percentage-derived cut would name a number that is not what
    // they will be paid, so it is omitted rather than shown.
    expect(body.projection.cleanerCutCents).toBeUndefined();
  });

  it('request-mode + payout_only cleaner: no cut AND no price signal at all', async () => {
    const apptId = await seedAppt({ totalPrice: 150 });
    const db = createTestSupabaseClient();
    await db
      .from('cleaner_profiles')
      .update({ payout_model: 'request' })
      .eq('id', org.cleaner.userId);
    await db
      .from('organizations')
      .update({ cleaner_pay_display: 'payout_only' })
      .eq('id', org.organizationId);

    const { status, body } = await callRoute<{ projection: Record<string, unknown> }>(
      handlerFor(apptId),
      {
        method: 'GET',
        url: urlFor(apptId, org.organizationId),
        headers: bearerHeader(org.cleaner.accessToken),
      },
    );

    expect(status).toBe(200);
    expect(body.projection.payoutModel).toBe('request');
    expect(body.projection.cleanerCutCents).toBeUndefined();
    expect(body.projection.chargeCents).toBeUndefined();
    expect(body.projection.baseCents).toBeUndefined();
    expect(body.projection.payoutPercent).toBeUndefined();
    // 150 dollars = 15000 cents must not survive anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('15000');
  });

  it('request-mode org staff still receive the projected cut (they author the offer)', async () => {
    const apptId = await seedAppt({ totalPrice: 150 });
    const db = createTestSupabaseClient();
    await db
      .from('cleaner_profiles')
      .update({ payout_model: 'request' })
      .eq('id', org.cleaner.userId);

    const { status, body } = await callRoute<{
      projection: { payoutModel: string; cleanerCutCents?: number };
    }>(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.admin.accessToken),
    });

    expect(status).toBe(200);
    expect(body.projection.payoutModel).toBe('request');
    expect(body.projection.cleanerCutCents).toBeDefined();
  });

  it("percentage cleaners keep payoutModel:'percentage' and their cut", async () => {
    const apptId = await seedAppt({ totalPrice: 150 });
    const { status, body } = await callRoute<{
      projection: { payoutModel: string; cleanerCutCents?: number };
    }>(handlerFor(apptId), {
      method: 'GET',
      url: urlFor(apptId, org.organizationId),
      headers: bearerHeader(org.cleaner.accessToken),
    });

    expect(status).toBe(200);
    expect(body.projection.payoutModel).toBe('percentage');
    expect(body.projection.cleanerCutCents).toBe(6000); // 40% of $150
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
