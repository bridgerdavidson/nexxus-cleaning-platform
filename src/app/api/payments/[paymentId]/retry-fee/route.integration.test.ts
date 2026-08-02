import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(async () => ({ id: 'pi_fee_retry', status: 'succeeded' })),
}));
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getPaymentMethodType: vi.fn(async () => 'card'),
}));

import { POST } from './route';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addManagerToOrg,
  addHomeownerToOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (paymentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ paymentId }) });

describe('POST /api/payments/:paymentId/retry-fee', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalFlag: string | undefined;
  const db = createTestSupabaseClient();

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    vi.mocked(createDestinationCharge).mockClear();
    vi.mocked(createDestinationCharge).mockResolvedValue({ id: 'pi_fee_retry', status: 'succeeded' } as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  async function seedFailedFee(opts: {
    apptStatus?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
    rowStatus?: string;
    chargeKind?: string;
    piStatus?: string;
  } = {}) {
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_ready_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    await db.from('user_profiles').update({ stripe_customer_id: 'cus_test_homeowner' }).eq('id', org.homeowner.userId);
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: opts.apptStatus ?? 'cancelled',
    });
    await db.from('appointments').update({ payment_method_id: 'pm_test_card', reauth_count: 0 }).eq('id', appt.id);
    const { data: pay } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 50,
        status: opts.rowStatus ?? 'failed',
        payment_type: 'revenue',
        payment_method: 'card',
        charge_kind: opts.chargeKind ?? 'cancellation_fee',
        payment_intent_status: opts.piStatus ?? 'requires_payment_method',
      })
      .select('id')
      .single();
    const paymentId = (pay as { id: string }).id;
    // The context the retry recovers party/no_show from.
    await db.from('payment_events').insert({
      payment_id: paymentId,
      appointment_id: appt.id,
      organization_id: org.organizationId,
      event_type: 'cancellation_fee_failed',
      actor: 'user:seed',
      amount: 5000,
      payload: { party: 'homeowner', no_show: true, inside_window: false },
    });
    return { appt, paymentId };
  }

  const post = (paymentId: string, token: string, orgId = org.organizationId) =>
    callRoute<Record<string, unknown>>(handlerFor(paymentId), {
      method: 'POST',
      headers: bearerHeader(token),
      body: { organization_id: orgId },
    });

  it('404 when the charge-flow flags are off', async () => {
    const { paymentId } = await seedFailedFee();
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const { status } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(404);
  });

  it('admin retry: 200, row flips to paid, counter bumped, breadcrumb + charged events written', async () => {
    const { appt, paymentId } = await seedFailedFee();
    const { status, body } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.code).toBe('charged');
    expect(body.fee_captured_cents).toBe(5000);

    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createDestinationCharge).mock.calls[0][0];
    expect(arg.grossCents).toBe(5000);
    expect(arg.keyPrefix).toBe('cancelfee');
    expect(arg.reauthAttempt).toBe(1);

    const { data: p } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((p as { status: string }).status).toBe('paid');

    const { data: events } = await db
      .from('payment_events')
      .select('event_type, payload')
      .eq('appointment_id', appt.id);
    const types = (events ?? []).map((e) => (e as { event_type: string }).event_type);
    expect(types).toContain('cancellation_fee_retry_requested');
    expect(types).toContain('cancellation_fee_charged');
    // Context recovered from the ledger, not defaulted: no_show=true flowed through.
    const charged = (events ?? []).find(
      (e) => (e as { event_type: string }).event_type === 'cancellation_fee_charged',
    ) as { payload: { no_show?: boolean } };
    expect(charged.payload.no_show).toBe(true);
  });

  it('homeowner retries their OWN failed fee: 200 paid', async () => {
    const { paymentId } = await seedFailedFee();
    const { status, body } = await post(paymentId, org.homeowner.accessToken);
    expect(status).toBe(200);
    expect(body.code).toBe('charged');
  });

  it("homeowner cannot retry another homeowner's fee: 403", async () => {
    const { paymentId } = await seedFailedFee();
    const other = await addHomeownerToOrg(org.organizationId);
    const { status } = await post(paymentId, other.accessToken);
    expect(status).toBe(403);
  });

  it("homeowner cannot probe another homeowner's PAID fee: 403, not 200 already", async () => {
    const { paymentId } = await seedFailedFee({ rowStatus: 'paid' });
    const other = await addHomeownerToOrg(org.organizationId);
    const { status, body } = await post(paymentId, other.accessToken);
    expect(status).toBe(403);
    expect(body.fee_captured_cents).toBeUndefined();
  });

  it('homeowner on a requires_action row: 409 requires_card_verification, no charge', async () => {
    const { paymentId } = await seedFailedFee({ piStatus: 'requires_action' });
    const { status, body } = await post(paymentId, org.homeowner.accessToken);
    expect(status).toBe(409);
    expect(body.code).toBe('requires_card_verification');
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('admin on a requires_action row is allowed through', async () => {
    const { paymentId } = await seedFailedFee({ piStatus: 'requires_action' });
    const { status } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(200);
  });

  it('manager without can_manage_payments: 403; with it: 200', async () => {
    const { paymentId } = await seedFailedFee();
    const noPerm = await addManagerToOrg(org.organizationId);
    expect((await post(paymentId, noPerm.accessToken)).status).toBe(403);

    const { paymentId: paymentId2 } = await seedFailedFee();
    const withPerm = await addManagerToOrg(org.organizationId, { can_manage_payments: true });
    expect((await post(paymentId2, withPerm.accessToken)).status).toBe(200);
  });

  it('manager without can_manage_payments gets 403 even on a paid row (no state leak)', async () => {
    const { paymentId } = await seedFailedFee({ rowStatus: 'paid' });
    const noPerm = await addManagerToOrg(org.organizationId);
    const { status } = await post(paymentId, noPerm.accessToken);
    expect(status).toBe(403);
  });

  it('cleaner: 403', async () => {
    const { paymentId } = await seedFailedFee();
    const { status } = await post(paymentId, org.cleaner.accessToken);
    expect(status).toBe(403);
  });

  it('payment in another org: 404 (no existence leak)', async () => {
    const { paymentId } = await seedFailedFee();
    const { status } = await post(paymentId, org2.admin.accessToken, org2.organizationId);
    expect(status).toBe(404);
  });

  it('non-fee row: 409', async () => {
    const { paymentId } = await seedFailedFee({ chargeKind: 'completion' });
    const { status, body } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(409);
    expect(body.code).toBe('not_retryable');
  });

  it('already-paid fee row: 200 no-op, no new charge', async () => {
    const { paymentId } = await seedFailedFee({ rowStatus: 'paid' });
    const { status, body } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(200);
    expect(body.code).toBe('charged');
    expect(body.already).toBe(true);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('pending fee row: 409 not_retryable', async () => {
    const { paymentId } = await seedFailedFee({ rowStatus: 'pending' });
    const { status } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(409);
  });

  it('non-cancelled appointment: 409', async () => {
    const { paymentId } = await seedFailedFee({ apptStatus: 'completed' });
    const { status } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(409);
  });

  it('decline on retry: 402, row stays failed', async () => {
    const { paymentId } = await seedFailedFee();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(new Error('Your card was declined.'));
    const { status, body } = await post(paymentId, org.admin.accessToken);
    expect(status).toBe(402);
    expect(body.code).toBe('failed');
    const { data: p } = await db.from('payments').select('status').eq('id', paymentId).single();
    expect((p as { status: string }).status).toBe('failed');
  });
});
