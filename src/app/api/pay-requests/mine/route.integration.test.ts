import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
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

  it('omits approved threads (they settle into earnings, not the queue)', async () => {
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
    expect((res.body as { threads: unknown[] }).threads).toHaveLength(0);
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
