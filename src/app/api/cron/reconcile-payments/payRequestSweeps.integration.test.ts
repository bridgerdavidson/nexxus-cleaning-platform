import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Pay-request awareness of the reconcile sweeps (migration 114): an unapproved
 * thread is normal business state, never "stuck money".
 *   - settleUnsettledCaptures skips captured rows whose thread is pending and
 *     settles them once approved.
 *   - chargeUncollectedCompletions skips self-pay completions whose thread is
 *     pending (their charge amount IS the approved cut).
 *   - checkMoneyMathInvariants flags a request payout paid ABOVE its approval
 *     and accepts one at/below it.
 */
vi.mock('@/lib/stripe/transfers', () => ({
  transferGroupFor: (id: string) => `appt_${id}`,
  createPlatformTransfer: vi.fn(
    async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
      id: `tr_prsweep_${p.appointmentId}_${p.destinationAccountId}`,
      amount: p.amountCents,
    }),
  ),
  listTransfersByGroup: vi.fn(async () => []),
  reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
  retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 6000, amount_reversed: 0 })),
}));

import {
  settleUnsettledCaptures,
  chargeUncollectedCompletions,
  checkMoneyMathInvariants,
} from '@/lib/payments/reconcile';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('reconcile sweeps vs pay-request threads', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    org = await withTestOrg({
      cleanerPayoutModel: 'request',
      stripeConnectAccountId: 'acct_cleaner_prsweep',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 0,
      platformFeeBps: 0,
      minMarginBps: 2000,
    });
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_tenant_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('settleUnsettledCaptures skips a pending thread and settles it after approval', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    // Captured revenue row, past the SLA, never split.
    const staleIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      charge_kind: 'completion',
      stripe_payment_intent_id: `pi_prsweep_${appt.id}`,
      captured_at: staleIso,
    });
    const pr = await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'pending_org',
      jobPriceCents: 10000,
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 9500, minMarginBpsSnapshot: 2000 }],
    });

    await settleUnsettledCaptures(db);
    // Nothing moved and no defer-event spam from the sweep (webhook-only marker).
    expect(
      vi.mocked(createPlatformTransfer).mock.calls.filter(
        (c) => (c[0] as { appointmentId: string }).appointmentId === appt.id,
      ),
    ).toHaveLength(0);
    const { data: deferEvents } = await db
      .from('payment_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'settlement_deferred_pay_request');
    expect((deferEvents ?? []).length).toBe(0);

    await db
      .from('pay_requests')
      .update({
        status: 'approved',
        approved_amount_cents: 8000,
        approved_via: 'org',
        approved_by: org.admin.userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pr.id);

    await settleUnsettledCaptures(db);
    const calls = vi
      .mocked(createPlatformTransfer)
      .mock.calls.map((c) => c[0] as { appointmentId: string; amountCents: number; destinationAccountId: string });
    const cleanerCall = calls.find(
      (c) => c.appointmentId === appt.id && c.destinationAccountId === 'acct_cleaner_prsweep',
    );
    expect(cleanerCall?.amountCents).toBe(8000);
  });

  it('chargeUncollectedCompletions skips a self-pay completion whose thread is pending', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_self_pay_customer_id: `cus_prsweep_${org.organizationId.slice(0, 12)}` })
      .eq('id', org.organizationId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
      orgOwnedProperty: true,
      selfPay: true,
    });
    // Past the 30-minute stale window.
    const staleIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db.from('appointments').update({ updated_at: staleIso }).eq('id', appt.id);
    await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'pending_org',
      jobPriceCents: 10000,
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 9500, minMarginBpsSnapshot: 2000 }],
    });

    const result = await chargeUncollectedCompletions(db, { organizationId: org.organizationId });
    expect(result.charged).toBe(0);
    // Skipped BEFORE the orchestrator: no charge claim, no authorization_status stamp.
    const { data: a } = await db.from('appointments').select('authorization_status').eq('id', appt.id).single();
    expect((a as { authorization_status: string | null }).authorization_status).toBeNull();
  });

  it('checkMoneyMathInvariants flags a request payout paid above its approval, accepts one at it', async () => {
    const db = createTestSupabaseClient();
    const seed = async (paidDollars: number, approvedCents: number) => {
      const appt = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
        status: 'completed',
        totalPrice: 100,
      });
      const pr = await createTestPayRequest({
        organizationId: org.organizationId,
        appointmentId: appt.id,
        cleanerId: org.cleaner.userId,
        status: 'approved',
        jobPriceCents: 10000,
        approvedAmountCents: approvedCents,
        approvedVia: 'org',
      });
      await db.from('payouts').insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appt.id,
        amount: paidDollars,
        status: 'paid',
        payout_percent_snapshot: null,
        payout_model_snapshot: 'request',
        pay_request_id: pr.id,
      });
      return appt.id;
    };
    const okId = await seed(72, 7200);
    const overpaidId = await seed(80, 7200);

    await checkMoneyMathInvariants(db);

    const violationsFor = async (apptId: string) => {
      const { data } = await db
        .from('payment_events')
        .select('id')
        .eq('appointment_id', apptId)
        .eq('event_type', 'money_math_violation');
      return (data ?? []).length;
    };
    expect(await violationsFor(okId)).toBe(0);
    expect(await violationsFor(overpaidId)).toBe(1);
  });
});
