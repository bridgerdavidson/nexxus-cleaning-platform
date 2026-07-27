import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addManagerToOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

/** Request-mode org: $350 job, 20% min margin -> auto-approve max $280.00. */
async function requestOrg(opts: Record<string, unknown> = {}) {
  return withTestOrg({
    cleanerPayoutModel: 'request',
    minMarginBps: 2000,
    platformFeeBps: 100,
    ...opts,
  });
}

describe('POST /api/appointments/[appointmentId]/pay-request', () => {
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await org?.cleanup();
    org = null;
  });

  function submit(appointmentId: string, body: Record<string, unknown>, token: string) {
    return callRoute(
      (req: NextRequest) => POST(req, { params: Promise.resolve({ appointmentId }) }),
      {
        method: 'POST',
        url: `http://test/api/appointments/${appointmentId}/pay-request`,
        headers: bearerHeader(token),
        body,
      },
    );
  }

  it('auto-approves a within-threshold cleaner request and records the offer + events', async () => {
    org = await requestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    const res = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 25000 }, org.cleaner.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as { autoApproved: boolean }).autoApproved).toBe(true);

    const admin = createTestSupabaseClient();
    const { data: pr } = await admin.from('pay_requests').select('*').eq('appointment_id', appt.id).single();
    const p = pr as Record<string, unknown>;
    expect(p.status).toBe('approved');
    expect(p.approved_via).toBe('auto');
    expect(p.approved_amount_cents).toBe(25000);
    expect(p.job_price_cents_snapshot).toBe(35000);
    expect(p.cleaner_id).toBe(org.cleaner.userId);

    const { data: offers } = await admin
      .from('pay_request_offers')
      .select('*')
      .eq('pay_request_id', p.id as string);
    expect(offers).toHaveLength(1);
    const offer = (offers as Record<string, unknown>[])[0];
    expect(offer.actor).toBe('cleaner');
    expect(offer.amount_cents).toBe(25000);
    expect(offer.min_margin_bps_snapshot).toBe(2000);
    expect(offer.auto_approved).toBe(true);

    const { data: events } = await admin
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    const types = (events as { event_type: string }[]).map((e) => e.event_type);
    expect(types).toContain('pay_request_submitted');
    expect(types).toContain('pay_request_auto_approved');
  });

  it('escalates an over-threshold request and notifies the org (excluding the cleaner)', async () => {
    org = await requestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    const res = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 34000 }, org.cleaner.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('pending_org');

    const admin = createTestSupabaseClient();
    const { data: pr } = await admin.from('pay_requests').select('*').eq('appointment_id', appt.id).single();
    expect((pr as { status: string }).status).toBe('pending_org');
    expect((pr as { approved_amount_cents: number | null }).approved_amount_cents).toBeNull();

    const { data: notifs } = await admin
      .from('notification_events')
      .select('recipient_user_id, event_type')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'pay_request_escalated');
    const rows = notifs as { recipient_user_id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.recipient_user_id)).not.toContain(org.cleaner.userId);
    expect(rows.map((r) => r.recipient_user_id)).toContain(org.admin.userId);
  });

  it('escalates an over-price request without leaking the price', async () => {
    org = await requestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    const res = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 40000 }, org.cleaner.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('pending_org');
    // The response body must carry no price signal for the payout_only cleaner.
    expect(JSON.stringify(res.body)).not.toContain('35000');
    expect(JSON.stringify(res.body)).not.toContain('350');
  });

  it('409s a duplicate submission for the same appointment', async () => {
    org = await requestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    const first = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 25000 }, org.cleaner.accessToken);
    expect(first.status).toBe(200);
    const second = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 26000 }, org.cleaner.accessToken);
    expect(second.status).toBe(409);
  });

  it('rejects non-request-mode cleaners with 400', async () => {
    org = await withTestOrg({ minMarginBps: 2000 }); // default percentage cleaner
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    const res = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 25000 }, org.cleaner.accessToken);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Pay requests are not enabled for this cleaner.');
  });

  it('404s a cleaner submitting on a job that is not theirs, and 403s a homeowner', async () => {
    org = await requestOrg();
    const other = await requestOrg();
    try {
      const appt = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
        totalPrice: 350,
        status: 'in_progress',
      });

      // Other org's cleaner is not a member of this org at all -> 403 from requireOrgAuth.
      const cross = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 100 }, other.cleaner.accessToken);
      expect(cross.status).toBe(403);

      // A homeowner in the right org is an allowed role nowhere in this route.
      const ho = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 100 }, org.homeowner.accessToken);
      expect(ho.status).toBe(403);

      // The org's OTHER appointment does not belong to this cleaner -> 404, no leak.
      const appt2 = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: null,
        homeownerId: org.homeowner.userId,
        totalPrice: 200,
        status: 'in_progress',
      });
      const notMine = await submit(appt2.id, { organization_id: org.organizationId, amount_cents: 100 }, org.cleaner.accessToken);
      expect(notMine.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });

  it('lets an admin open an org-authored thread at pending_cleaner', async () => {
    org = await requestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    const res = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 20000 }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('pending_cleaner');
    expect((res.body as { autoApproved: boolean }).autoApproved).toBe(false);

    const admin = createTestSupabaseClient();
    const { data: pr } = await admin.from('pay_requests').select('*').eq('appointment_id', appt.id).single();
    expect((pr as { status: string }).status).toBe('pending_cleaner');

    const { data: offers } = await admin
      .from('pay_request_offers')
      .select('actor, min_margin_bps_snapshot, auto_approved')
      .eq('pay_request_id', (pr as { id: string }).id);
    expect(offers).toHaveLength(1);
    expect((offers as Record<string, unknown>[])[0].actor).toBe('org');
    expect((offers as Record<string, unknown>[])[0].min_margin_bps_snapshot).toBeNull();

    const { data: notifs } = await admin
      .from('notification_events')
      .select('recipient_user_id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'pay_request_countered');
    expect((notifs as { recipient_user_id: string }[]).map((n) => n.recipient_user_id)).toContain(org.cleaner.userId);
  });

  it('403s a manager without the Manage Payments permission and allows one with it', async () => {
    org = await requestOrg();
    const [denied, allowed] = await Promise.all([
      addManagerToOrg(org.organizationId, {}),
      addManagerToOrg(org.organizationId, { can_manage_payments: true }),
    ]);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    const no = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 20000 }, denied.accessToken);
    expect(no.status).toBe(403);

    const yes = await submit(appt.id, { organization_id: org.organizationId, amount_cents: 20000 }, allowed.accessToken);
    expect(yes.status).toBe(200);
    expect((yes.body as { status: string }).status).toBe('pending_cleaner');
  });

  it('400s invalid amounts', async () => {
    org = await requestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 350,
      status: 'in_progress',
    });

    for (const amount of [-1, 10.5, 'abc', undefined]) {
      const res = await submit(appt.id, { organization_id: org.organizationId, amount_cents: amount }, org.cleaner.accessToken);
      expect(res.status).toBe(400);
    }
  });
});
