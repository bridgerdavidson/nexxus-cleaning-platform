import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createAuthUser,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

describe('POST /api/pay-requests/[payRequestId]/respond', () => {
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await org?.cleanup();
    org = null;
  });

  /** pending_cleaner thread: cleaner asked $340, org countered $250, on a $350 job at 20% margin. */
  async function seed(status: 'pending_org' | 'pending_cleaner' = 'pending_cleaner') {
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

  function respond(payRequestId: string, body: Record<string, unknown>, token: string) {
    return callRoute(
      (req: NextRequest) => POST(req, { params: Promise.resolve({ payRequestId }) }),
      {
        method: 'POST',
        url: `http://test/api/pay-requests/${payRequestId}/respond`,
        headers: bearerHeader(token),
        body,
      },
    );
  }

  it("accepts the org's counter: approved at the org amount, org notified without the cleaner", async () => {
    const { appt, pr } = await seed();
    const res = await respond(
      pr.id,
      { organization_id: org!.organizationId, accept: true },
      org!.cleaner.accessToken,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('approved');
    expect(body.approvedAmountCents).toBe(25000);
    expect(body.settlement).toBe('deferred');

    const admin = createTestSupabaseClient();
    const { data } = await admin.from('pay_requests').select('*').eq('id', pr.id).single();
    const row = data as Record<string, unknown>;
    expect(row.approved_via).toBe('cleaner_accept');
    expect(row.approved_by).toBe(org!.cleaner.userId);

    const { data: notifs } = await admin
      .from('notification_events')
      .select('recipient_user_id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'pay_request_accepted');
    const recipients = (notifs as { recipient_user_id: string }[]).map((n) => n.recipient_user_id);
    expect(recipients).toContain(org!.admin.userId);
    expect(recipients).not.toContain(org!.cleaner.userId);
  });

  it('counters back under the threshold: auto-approves on the spot', async () => {
    const { pr } = await seed();
    const res = await respond(
      pr.id,
      { organization_id: org!.organizationId, amount_cents: 26000 },
      org!.cleaner.accessToken,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('approved');
    expect(body.autoApproved).toBe(true);
    expect(body.approvedAmountCents).toBe(26000);

    const admin = createTestSupabaseClient();
    const { data } = await admin.from('pay_requests').select('approved_via, approved_by').eq('id', pr.id).single();
    expect((data as { approved_via: string }).approved_via).toBe('auto');
    expect((data as { approved_by: string | null }).approved_by).toBeNull();

    const { data: offers } = await admin
      .from('pay_request_offers')
      .select('actor, amount_cents, min_margin_bps_snapshot, auto_approved')
      .eq('pay_request_id', pr.id)
      .order('created_at', { ascending: true });
    const last = (offers as Record<string, unknown>[]).at(-1)!;
    expect(last.actor).toBe('cleaner');
    expect(last.min_margin_bps_snapshot).toBe(2000);
    expect(last.auto_approved).toBe(true);
  });

  it('counters back over the threshold: escalates to the org again', async () => {
    const { appt, pr } = await seed();
    const res = await respond(
      pr.id,
      { organization_id: org!.organizationId, amount_cents: 32000 },
      org!.cleaner.accessToken,
    );
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('pending_org');

    const admin = createTestSupabaseClient();
    const { data: notifs } = await admin
      .from('notification_events')
      .select('recipient_user_id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'pay_request_escalated');
    expect((notifs as { recipient_user_id: string }[]).map((n) => n.recipient_user_id)).toContain(
      org!.admin.userId,
    );
  });

  it('409s an accept while the thread is waiting on the org', async () => {
    const { pr } = await seed('pending_org');
    const res = await respond(
      pr.id,
      { organization_id: org!.organizationId, accept: true },
      org!.cleaner.accessToken,
    );
    expect(res.status).toBe(409);
  });

  it("404s a different cleaner in the same org (own-thread only)", async () => {
    const { pr } = await seed();
    const admin = createTestSupabaseClient();
    const intruder = await createAuthUser(`cleaner2-${pr.id.slice(0, 8)}@test.local`, 'cleaner', 'Cleaner2');
    await admin.from('user_profiles').upsert(
      [{ id: intruder.id, email: intruder.email, first_name: 'Cleaner2', last_name: 'Test', role: 'cleaner' }],
      { onConflict: 'id' },
    );
    await admin.from('organization_members').insert({
      user_id: intruder.id,
      organization_id: org!.organizationId,
      role: 'cleaner',
    });
    try {
      const res = await respond(
        pr.id,
        { organization_id: org!.organizationId, accept: true },
        intruder.accessToken,
      );
      expect(res.status).toBe(404);
    } finally {
      await admin.auth.admin.deleteUser(intruder.id);
    }
  });

  it('400s a body with neither accept nor amount', async () => {
    const { pr } = await seed();
    const res = await respond(pr.id, { organization_id: org!.organizationId }, org!.cleaner.accessToken);
    expect(res.status).toBe(400);
  });
});
