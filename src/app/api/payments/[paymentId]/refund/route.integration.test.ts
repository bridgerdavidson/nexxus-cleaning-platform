import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/stripe/charges/refund', () => ({
  createRefund: vi.fn(async () => ({ id: 're_test_123' })),
  reverseCleanerTransfer: vi.fn(async () => ({ id: 'trr_test_123' })),
}));

import { POST } from './route';
import { createRefund, reverseCleanerTransfer } from '@/lib/stripe/charges/refund';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (paymentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ paymentId }) });

describe('POST /api/payments/:paymentId/refund', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function seedPaidPayment(opts: { status?: string } = {}) {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });
    const { data: pay } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: opts.status ?? 'paid',
        payment_method: 'card',
        payment_type: 'revenue',
        stripe_payment_intent_id: `pi_${appt.id}`,
      })
      .select('id')
      .single();
    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 60,
      status: 'paid',
      stripe_transfer_id: 'tr_x',
      source_balance_account_id: 'acct_tenant',
    });
    return { appt, paymentId: (pay as { id: string }).id };
  }

  it('returns 401 with no Authorization header', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status } = await callRoute(handlerFor(paymentId), {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status } = await callRoute(handlerFor(paymentId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('409 when the payment is not in a paid state', async () => {
    const { paymentId } = await seedPaidPayment({ status: 'pending' });
    const { status } = await callRoute(handlerFor(paymentId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
  });

  it('full refund: refunds homeowner, reverses cleaner transfer, marks payment refunded', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status, body } = await callRoute<{ success: boolean; fully_refunded: boolean; amount_cents: number }>(
      handlerFor(paymentId),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );
    expect(status).toBe(200);
    expect(body.fully_refunded).toBe(true);
    expect(body.amount_cents).toBe(10000);

    // full refund → no explicit amount; full cascade
    expect(vi.mocked(createRefund)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createRefund).mock.calls[0][0]).toMatchObject({
      reverseTransfer: true,
      refundApplicationFee: true,
      amountCents: undefined,
    });
    expect(vi.mocked(reverseCleanerTransfer)).toHaveBeenCalledWith('tr_x', 6000, 'acct_tenant');

    const db = createTestSupabaseClient();
    const { data: pay } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((pay as { status: string }).status).toBe('refunded');

    const { data: refunds } = await db.from('refunds').select('amount, status').eq('payment_id', paymentId);
    expect(refunds).toHaveLength(1);
    expect(Number((refunds![0] as { amount: number }).amount)).toBe(10000);
  });

  it('partial refund: reverses proportional cleaner amount, payment stays paid', async () => {
    const { paymentId } = await seedPaidPayment();
    const { status, body } = await callRoute<{ fully_refunded: boolean; amount_cents: number }>(
      handlerFor(paymentId),
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId, amount: 40 },
      },
    );
    expect(status).toBe(200);
    expect(body.fully_refunded).toBe(false);
    expect(body.amount_cents).toBe(4000);

    // 60% payout of $100 = $60; proportional to a $40 refund = $24 = 2400 cents
    expect(vi.mocked(reverseCleanerTransfer)).toHaveBeenCalledWith('tr_x', 2400, 'acct_tenant');

    const db = createTestSupabaseClient();
    const { data: pay } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((pay as { status: string }).status).toBe('paid');
  });
});
