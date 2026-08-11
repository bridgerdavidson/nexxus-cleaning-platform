/**
 * Integration tests: payment_stats RPC precision + refund netting (audit T2-11 + the
 * T2-3 residual, migration 20260811203429_payment_stats_cents).
 *
 * Asserts, against a real local Supabase as an authed org admin (SECURITY INVOKER,
 * so RLS on payments/payouts/refunds applies exactly as in production):
 *   - stats are integer CENTS, not whole-dollar rounded ($123.45 stays 12345¢)
 *   - 'pending' + 'succeeded' refunds net a still-'paid' payment; 'failed' does not
 *   - a fully-refunded payment (status='refunded') is excluded WITHOUT its refunds
 *     being subtracted again
 *   - self-pay revenue is excluded; old payments count toward total but not this-month
 *   - the legacy dollar keys are still present and cents-precise (deploy-window compat)
 *
 * Requires `npx supabase start` + .env.test.local (see CLAUDE.md "Running tests").
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';

/** Anon-key client carrying the user's JWT so the RPC sees auth.uid() (same pattern
 *  as analytics_rpcs.integration.test.ts). */
function clientAs(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

describe('payment_stats cents precision + refund netting', () => {
  const admin = createTestSupabaseClient();
  let org: TestOrgFixture;
  let stats: Record<string, number>;

  /** Seed one appointment + one payments row (unique appointment per payment: 088's
   *  partial unique indexes allow only one Stripe revenue row / payout per appt). */
  async function seedPayment(row: {
    amount: number;
    status?: string;
    isSelfPay?: boolean;
    createdAt?: string;
  }): Promise<{ paymentId: string; appointmentId: string }> {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
    const { data, error } = await admin
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: row.amount,
        status: row.status ?? 'paid',
        payment_type: 'revenue',
        is_self_pay: row.isSelfPay ?? false,
        ...(row.createdAt ? { created_at: row.createdAt } : {}),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`payment seed failed: ${error?.message}`);
    return { paymentId: data.id as string, appointmentId: appt.id };
  }

  async function seedRefund(p: { paymentId: string; appointmentId: string }, amountCents: number, status: string) {
    const { error } = await admin.from('refunds').insert({
      organization_id: org.organizationId,
      payment_id: p.paymentId,
      appointment_id: p.appointmentId,
      stripe_refund_id: `re_test_${p.paymentId.slice(0, 8)}_${status}_${amountCents}`,
      amount: amountCents,
      initiator_user_id: org.admin.userId,
      status,
    });
    if (error) throw new Error(`refund seed failed: ${error.message}`);
  }

  beforeAll(async () => {
    org = await withTestOrg();

    // $123.45 clean paid revenue: the whole-dollar 077 RPC would have reported 123.
    await seedPayment({ amount: 123.45 });

    // $200.00 partially refunded: succeeded 30.00 + pending 10.00 net; failed 999.99 must not.
    const partial = await seedPayment({ amount: 200 });
    await seedRefund(partial, 3000, 'succeeded');
    await seedRefund(partial, 1000, 'pending');
    await seedRefund(partial, 99999, 'failed');

    // Fully refunded $50: excluded by status; its refund row must NOT subtract again.
    const full = await seedPayment({ amount: 50, status: 'refunded' });
    await seedRefund(full, 5000, 'succeeded');

    // Self-pay $75: excluded from revenue.
    await seedPayment({ amount: 75, isSelfPay: true });

    // Old $10.01 (2020): in the all-time total, not in this-month.
    await seedPayment({ amount: 10.01, createdAt: '2020-06-15T12:00:00Z' });

    // Payouts: pending $80.25 counts; a paid one does not.
    for (const payout of [
      { amount: 80.25, status: 'pending' },
      { amount: 999, status: 'paid' },
    ]) {
      const appt = await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
        status: 'completed',
      });
      const { error } = await admin.from('payouts').insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appt.id,
        amount: payout.amount,
        status: payout.status,
      });
      if (error) throw new Error(`payout seed failed: ${error.message}`);
    }

    const { data, error } = await clientAs(org.admin.accessToken).rpc('payment_stats', {
      p_org_id: org.organizationId,
    });
    expect(error).toBeNull();
    stats = data as Record<string, number>;
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it('returns integer cents: exact amounts, partial refunds netted, refunded/self-pay excluded', () => {
    // 12345 (clean) + 16000 (20000 - 3000 succeeded - 1000 pending) + 1001 (old row)
    expect(stats.totalRevenueCents).toBe(29346);
    expect(Number.isInteger(stats.totalRevenueCents)).toBe(true);
  });

  it('this-month window keeps refund netting and drops the old payment', () => {
    expect(stats.thisMonthRevenueCents).toBe(28345);
  });

  it('pending payouts are cents-precise and exclude non-pending rows', () => {
    expect(stats.pendingPayoutsCents).toBe(8025);
  });

  it('legacy dollar keys stay present and are cents-precise, not whole-dollar rounded', () => {
    expect(Number(stats.totalRevenue)).toBeCloseTo(293.46, 5);
    expect(Number(stats.thisMonthRevenue)).toBeCloseTo(283.45, 5);
    expect(Number(stats.pendingPayouts)).toBeCloseTo(80.25, 5);
  });
});
