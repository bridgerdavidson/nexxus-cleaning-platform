import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import {
  withTestOrg,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';

/**
 * The cleaner's own view of their pay-request threads. Migration 119 removed
 * the cleaner's RLS read on pay_requests because the row carries
 * job_price_cents_snapshot, so this route is the price-free replacement: the
 * price-leak assertions below are the point of the file.
 */
describe('GET /api/pay-requests/mine', () => {
  let org: TestOrgFixture | null = null;
  let other: TestOrgFixture | null = null;

  afterEach(async () => {
    await org?.cleanup();
    await other?.cleanup();
    org = null;
    other = null;
  });

  function get(params: Record<string, string>, token: string) {
    const qs = new URLSearchParams(params).toString();
    return callRoute((req: NextRequest) => GET(req), {
      method: 'GET',
      url: `http://test/api/pay-requests/mine?${qs}`,
      headers: bearerHeader(token),
    });
  }

  async function seedThread(opts: { status?: 'pending_org' | 'pending_cleaner' } = {}) {
    org = await withTestOrg({ cleanerPayoutModel: 'request', minMarginBps: 2000 });
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'completed',
    });
    const pr = await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: opts.status ?? 'pending_org',
      jobPriceCents: 35000,
      offers: [
        {
          actor: 'cleaner',
          actorUserId: org.cleaner.userId,
          amountCents: 30000,
          minMarginBpsSnapshot: 2000,
        },
        ...(opts.status === 'pending_cleaner'
          ? [
              {
                actor: 'org' as const,
                actorUserId: org.admin.userId,
                amountCents: 25000,
                note: 'Standard rate for this size',
              },
            ]
          : []),
      ],
    });
    return { appt, pr };
  }

  it('returns the cleaner\'s open threads with offer history and no price signal', async () => {
    const { appt } = await seedThread({ status: 'pending_cleaner' });
    const res = await get({ organization_id: org!.organizationId }, org!.cleaner.accessToken);
    expect(res.status).toBe(200);

    const body = res.body as { threads: Record<string, unknown>[] };
    expect(body.threads).toHaveLength(1);
    const t = body.threads[0];
    expect(t.appointmentId).toBe(appt.id);
    expect(t.status).toBe('pending_cleaner');
    expect(t.currentOfferCents).toBe(25000);
    expect((t.offers as unknown[])).toHaveLength(2);

    // THE POINT OF THIS ROUTE: the job price (35000 cents / $350) must not
    // appear anywhere in the payload, in any spelling.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('35000');
    expect(raw).not.toContain('jobPrice');
    expect(raw).not.toContain('job_price');
  });

  it('includes a recently-approved thread with its approved amount, still price-free', async () => {
    org = await withTestOrg({ cleanerPayoutModel: 'request' });
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'completed',
    });
    await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'approved',
      jobPriceCents: 35000,
      approvedAmountCents: 28000,
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 28000 }],
    });

    const res = await get({ organization_id: org.organizationId }, org.cleaner.accessToken);
    expect(res.status).toBe(200);
    // An approved thread stays visible until the payout row exists, otherwise
    // just-agreed pay is briefly visible nowhere on the cleaner's screens.
    const body = res.body as { threads: { status: string; approvedAmountCents: number }[] };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].status).toBe('approved');
    expect(body.threads[0].approvedAmountCents).toBe(28000);
    expect(JSON.stringify(body)).not.toContain('35000');
  });

  it('hands an approved thread off once its payout row exists', async () => {
    org = await withTestOrg({ cleanerPayoutModel: 'request' });
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'completed',
    });
    await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'approved',
      jobPriceCents: 35000,
      approvedAmountCents: 28000,
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 28000 }],
    });
    // Settlement ran: the payout row now owns this money on the Earnings
    // screen, so the thread must leave the list instead of stacking on top.
    const db = createTestSupabaseClient();
    const { error: payoutError } = await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 280,
      status: 'paid',
      payout_model_snapshot: 'request',
    });
    expect(payoutError).toBeNull();

    const res = await get({ organization_id: org.organizationId }, org.cleaner.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as { threads: unknown[] }).threads).toHaveLength(0);
  });

  it('a payout on one job does not hide a different open thread', async () => {
    // Regression guard for the handoff filter's scoping: the exclusion is by
    // appointment, never "this cleaner has some payout somewhere".
    const { appt: openAppt } = await seedThread({ status: 'pending_cleaner' });
    const settled = await createTestAppointment({
      organizationId: org!.organizationId,
      cleanerId: org!.cleaner.userId,
      homeownerId: org!.homeowner.userId,
      totalPrice: 200,
      status: 'completed',
    });
    await createTestPayRequest({
      organizationId: org!.organizationId,
      appointmentId: settled.id,
      cleanerId: org!.cleaner.userId,
      status: 'approved',
      jobPriceCents: 20000,
      approvedAmountCents: 15000,
      offers: [{ actor: 'cleaner', actorUserId: org!.cleaner.userId, amountCents: 15000 }],
    });
    const db = createTestSupabaseClient();
    const { error: payoutError } = await db.from('payouts').insert({
      organization_id: org!.organizationId,
      cleaner_id: org!.cleaner.userId,
      appointment_id: settled.id,
      amount: 150,
      status: 'paid',
      payout_model_snapshot: 'request',
    });
    expect(payoutError).toBeNull();

    const res = await get({ organization_id: org!.organizationId }, org!.cleaner.accessToken);
    expect(res.status).toBe(200);
    const threads = (res.body as { threads: { appointmentId: string; status: string }[] }).threads;
    expect(threads).toHaveLength(1);
    expect(threads[0].appointmentId).toBe(openAppt.id);
    expect(threads[0].status).toBe('pending_cleaner');
  });

  it('anchors off the cleaner\'s own approved history at the same property', async () => {
    org = await withTestOrg({ cleanerPayoutModel: 'request' });
    // An earlier, approved job at a property...
    const past = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 300,
      status: 'completed',
    });
    await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: past.id,
      cleanerId: org.cleaner.userId,
      status: 'approved',
      jobPriceCents: 30000,
      approvedAmountCents: 24000,
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 24000 }],
    });

    const res = await get(
      { organization_id: org.organizationId, appointment_id: past.id },
      org.cleaner.accessToken,
    );
    expect(res.status).toBe(200);
    const anchor = (res.body as { anchor: { amountCents: number; samePlace: boolean } | null })
      .anchor;
    expect(anchor).not.toBeNull();
    expect(anchor!.amountCents).toBe(24000);
    expect(anchor!.samePlace).toBe(true);
    // Even the anchor path must not leak the price.
    expect(JSON.stringify(res.body)).not.toContain('30000');
  });

  it('returns a null anchor when the cleaner has no approved history', async () => {
    const { appt } = await seedThread();
    const res = await get(
      { organization_id: org!.organizationId, appointment_id: appt.id },
      org!.cleaner.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as { anchor: unknown }).anchor).toBeNull();
  });

  it('never anchors off a job that is not the caller\'s', async () => {
    const { appt } = await seedThread();
    other = await withTestOrg({ cleanerPayoutModel: 'request' });
    // Another org's cleaner asks about this org's appointment id.
    const res = await get(
      { organization_id: other.organizationId, appointment_id: appt.id },
      other.cleaner.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as { anchor: unknown }).anchor).toBeNull();
    expect((res.body as { threads: unknown[] }).threads).toHaveLength(0);
  });

  it('rejects org staff (this is the cleaner surface; staff use the queue)', async () => {
    await seedThread();
    const res = await get({ organization_id: org!.organizationId }, org!.admin.accessToken);
    expect(res.status).toBe(403);
  });

  it('rejects a request with no organization_id', async () => {
    await seedThread();
    const res = await get({}, org!.cleaner.accessToken);
    expect(res.status).toBe(400);
  });
});
