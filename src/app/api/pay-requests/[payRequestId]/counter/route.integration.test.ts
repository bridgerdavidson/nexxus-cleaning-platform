import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

describe('POST /api/pay-requests/[payRequestId]/counter', () => {
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await org?.cleanup();
    org = null;
  });

  async function seed(status: 'pending_org' | 'pending_cleaner' = 'pending_org') {
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
      status,
      jobPriceCents: 35000,
      offers: [
        { actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 34000, minMarginBpsSnapshot: 2000 },
        ...(status === 'pending_cleaner'
          ? [{ actor: 'org' as const, actorUserId: org.admin.userId, amountCents: 25000 }]
          : []),
      ],
    });
    return { appt, pr };
  }

  function counter(payRequestId: string, body: Record<string, unknown>, token: string) {
    return callRoute(
      (req: NextRequest) => POST(req, { params: Promise.resolve({ payRequestId }) }),
      {
        method: 'POST',
        url: `http://test/api/pay-requests/${payRequestId}/counter`,
        headers: bearerHeader(token),
        body,
      },
    );
  }

  it('counters with an amount + note and hands the thread to the cleaner', async () => {
    const { appt, pr } = await seed();
    const res = await counter(
      pr.id,
      { organization_id: org!.organizationId, amount_cents: 26000, note: 'Deep clean was quoted lower' },
      org!.admin.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('pending_cleaner');

    const admin = createTestSupabaseClient();
    const { data: offers } = await admin
      .from('pay_request_offers')
      .select('actor, amount_cents, note, min_margin_bps_snapshot')
      .eq('pay_request_id', pr.id)
      .order('created_at', { ascending: true });
    const list = offers as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    expect(list[1].actor).toBe('org');
    expect(list[1].amount_cents).toBe(26000);
    expect(list[1].note).toBe('Deep clean was quoted lower');
    expect(list[1].min_margin_bps_snapshot).toBeNull();

    const { data: notifs } = await admin
      .from('notification_events')
      .select('recipient_user_id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'pay_request_countered');
    expect((notifs as { recipient_user_id: string }[]).map((n) => n.recipient_user_id)).toContain(
      org!.cleaner.userId,
    );
  });

  it('caps the counter at the job price with org-facing copy', async () => {
    const { pr } = await seed();
    const res = await counter(
      pr.id,
      { organization_id: org!.organizationId, amount_cents: 40000 },
      org!.admin.accessToken,
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Counter cannot exceed the job price.');
  });

  it('409s when the thread is already waiting on the cleaner', async () => {
    const { pr } = await seed('pending_cleaner');
    const res = await counter(
      pr.id,
      { organization_id: org!.organizationId, amount_cents: 24000 },
      org!.admin.accessToken,
    );
    expect(res.status).toBe(409);
  });

  it('400s invalid amounts', async () => {
    const { pr } = await seed();
    for (const amount of [-1, 12.5, undefined]) {
      const res = await counter(
        pr.id,
        { organization_id: org!.organizationId, amount_cents: amount },
        org!.admin.accessToken,
      );
      expect(res.status).toBe(400);
    }
  });
});
