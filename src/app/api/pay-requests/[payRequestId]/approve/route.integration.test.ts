import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addManagerToOrg,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

describe('POST /api/pay-requests/[payRequestId]/approve', () => {
  let org: TestOrgFixture | null = null;
  let other: TestOrgFixture | null = null;

  afterEach(async () => {
    await org?.cleanup();
    await other?.cleanup();
    org = null;
    other = null;
  });

  async function seed(opts: { status?: 'pending_org' | 'pending_cleaner'; askCents?: number } = {}) {
    org = await withTestOrg({ cleanerPayoutModel: 'request', minMarginBps: 2000, platformFeeBps: 100 });
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
          amountCents: opts.askCents ?? 30000,
          minMarginBpsSnapshot: 2000,
        },
        ...(opts.status === 'pending_cleaner'
          ? [{ actor: 'org' as const, actorUserId: org.admin.userId, amountCents: 25000 }]
          : []),
      ],
    });
    return { appt, pr };
  }

  function approve(payRequestId: string, organizationId: string, token: string) {
    return callRoute(
      (req: NextRequest) => POST(req, { params: Promise.resolve({ payRequestId }) }),
      {
        method: 'POST',
        url: `http://test/api/pay-requests/${payRequestId}/approve`,
        headers: bearerHeader(token),
        body: { organization_id: organizationId },
      },
    );
  }

  it('approves the latest cleaner ask, stamps approval fields, and defers settlement when no charge exists', async () => {
    const { pr } = await seed();
    const res = await approve(pr.id, org!.organizationId, org!.admin.accessToken);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('approved');
    expect(body.approvedAmountCents).toBe(30000);
    expect(body.alreadyApproved).toBe(false);
    expect(body.settlement).toBe('deferred'); // no revenue row seeded

    const admin = createTestSupabaseClient();
    const { data } = await admin.from('pay_requests').select('*').eq('id', pr.id).single();
    const row = data as Record<string, unknown>;
    expect(row.status).toBe('approved');
    expect(row.approved_via).toBe('org');
    expect(row.approved_by).toBe(org!.admin.userId);
    expect(row.approved_amount_cents).toBe(30000);
  });

  it('is idempotent: a second approve is a 200 no-op', async () => {
    const { pr } = await seed();
    const first = await approve(pr.id, org!.organizationId, org!.admin.accessToken);
    expect(first.status).toBe(200);
    const second = await approve(pr.id, org!.organizationId, org!.admin.accessToken);
    expect(second.status).toBe(200);
    expect((second.body as { alreadyApproved: boolean }).alreadyApproved).toBe(true);
    expect((second.body as { approvedAmountCents: number }).approvedAmountCents).toBe(30000);
  });

  it('409s when the thread is waiting on the cleaner', async () => {
    const { pr } = await seed({ status: 'pending_cleaner' });
    const res = await approve(pr.id, org!.organizationId, org!.admin.accessToken);
    expect(res.status).toBe(409);
  });

  it('refuses to approve an over-price ask as-is (org must counter)', async () => {
    const { pr } = await seed({ askCents: 40000 });
    const res = await approve(pr.id, org!.organizationId, org!.admin.accessToken);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('Counter');

    const admin = createTestSupabaseClient();
    const { data } = await admin.from('pay_requests').select('status').eq('id', pr.id).single();
    expect((data as { status: string }).status).toBe('pending_org');
  });

  it('CAPTURE GATE: never settles off a failed charge - approval defers with no transfer attempt', async () => {
    // The PR2 review's critical finding: a declined completion charge leaves a
    // status='failed' revenue row; approving the thread must NOT move money.
    const { appt, pr } = await seed();
    const admin = createTestSupabaseClient();
    await admin
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_tenant_${org!.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org!.organizationId);
    await admin.from('cleaner_profiles')
      .update({ stripe_connect_account_id: 'acct_test', stripe_connect_onboarding_complete: true })
      .eq('id', org!.cleaner.userId);
    await admin.from('payments').insert({
      organization_id: org!.organizationId,
      appointment_id: appt.id,
      amount: 350,
      status: 'failed',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_declined_${appt.id}`,
    });

    const res = await approve(pr.id, org!.organizationId, org!.admin.accessToken);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('approved');
    expect((res.body as { settlement: string }).settlement).toBe('deferred');

    // Deferred BEFORE any transfer attempt: a gate-less path would have tried
    // the tenant leg and recorded tenant_transfer_failed (stubbed Stripe throws).
    const { data: events } = await admin
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', appt.id);
    const types = (events as { event_type: string }[]).map((e) => e.event_type);
    expect(types).not.toContain('tenant_transfer_failed');
    expect(types).not.toContain('cleaner_paid');
    const { data: payouts } = await admin.from('payouts').select('id').eq('appointment_id', appt.id);
    expect(payouts ?? []).toHaveLength(0);
  });

  it('403s a manager without the Manage Payments permission', async () => {
    const { pr } = await seed();
    const denied = await addManagerToOrg(org!.organizationId, {});
    const res = await approve(pr.id, org!.organizationId, denied.accessToken);
    expect(res.status).toBe(403);
  });

  it("404s another org's pay request without confirming it exists", async () => {
    const { pr } = await seed();
    other = await withTestOrg({ cleanerPayoutModel: 'request' });
    const res = await approve(pr.id, other.organizationId, other.admin.accessToken);
    expect(res.status).toBe(404);
  });
});
