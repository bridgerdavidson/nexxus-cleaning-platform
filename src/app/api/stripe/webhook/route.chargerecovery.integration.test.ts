import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Charge-at-completion recovery + cancelled-job refund paths of the webhook (sibling of
 * route.integration.test.ts, whose mocks deliberately leave the charge primitives real):
 *
 *   1. setup_intent.succeeded re-points a COMPLETED job stuck on a failed card and charges the
 *      new card immediately (bumped reauth attempt = fresh idempotency key).
 *   2. payment_intent.succeeded for a COMPLETION charge on a since-cancelled appointment issues
 *      a full refund instead of settling (the in-flight-ACH-cancel money leak).
 *   3. The CANCELLATION FEE charge on a cancelled appointment still settles to the tenant.
 *   4. The migration-088 partial unique index rejects a second Stripe-backed revenue row.
 */
vi.mock('@/lib/stripe/transfers', () => ({
  transferGroupFor: (id: string) => `appt_${id}`,
  createPlatformTransfer: vi.fn(
    async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
      id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
      amount: p.amountCents,
    }),
  ),
  listTransfersByGroup: vi.fn(async () => []),
  reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
}));

vi.mock('@/lib/stripe/charges/refund', () => ({
  createRefund: vi.fn(async () => ({ id: `re_test_${crypto.randomUUID()}` })),
}));

vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(async (p: { appointmentId: string }) => ({
    id: `pi_recovered_${p.appointmentId}`,
    status: 'succeeded',
  })),
}));

vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getPaymentMethodType: vi.fn(async () => 'card'),
  paymentMethodBelongsToCustomer: vi.fn(async () => true),
  listSavedCards: vi.fn(async () => []),
}));

import { POST } from './route';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { createRefund } from '@/lib/stripe/charges/refund';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  buildPaymentIntentSucceededEvent,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { signWebhookPayload } from '../../../../../tests/helpers/stripe';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

async function postEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const sig = signWebhookPayload(payload);
  return callRoute(POST, {
    method: 'POST',
    url: 'http://test.local/api/stripe/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: payload,
  });
}

describe('POST /api/stripe/webhook (charge recovery + cancelled-job refunds)', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_recov',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_tenant_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_ho_recovery' })
      .eq('id', org.homeowner.userId);
    vi.mocked(createDestinationCharge).mockClear();
    vi.mocked(createRefund).mockClear();
    vi.mocked(createPlatformTransfer).mockClear();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('setup_intent.succeeded re-points AND immediately charges a completed job stuck on a failed card', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    await db
      .from('appointments')
      .update({ authorization_status: 'failed', payment_method_id: 'pm_dead_card', reauth_count: 0 })
      .eq('id', appt.id);

    const token = `tok_recov_${appt.id}`;
    await db.from('homeowner_payment_links').insert({
      homeowner_id: org.homeowner.userId,
      organization_id: org.organizationId,
      token,
      status: 'pending',
      created_by: org.admin.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { status } = await postEvent({
      id: `evt_si_recov_${appt.id}`,
      object: 'event',
      type: 'setup_intent.succeeded',
      data: {
        object: {
          id: 'seti_recovery_completed',
          object: 'setup_intent',
          status: 'succeeded',
          payment_method: 'pm_new_working_card',
          metadata: { token },
        },
      },
    });
    expect(status).toBe(200);

    // Re-pointed with a fresh attempt counter, then charged: the new card, not the dead one.
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createDestinationCharge).mock.calls[0][0] as {
      paymentMethodId: string;
      reauthAttempt?: number;
    };
    expect(arg.paymentMethodId).toBe('pm_new_working_card');
    expect(arg.reauthAttempt).toBe(1);

    const { data: apptRow } = await db
      .from('appointments')
      .select('payment_method_id, reauth_count, authorization_status')
      .eq('id', appt.id)
      .single();
    const a = apptRow as { payment_method_id: string; reauth_count: number; authorization_status: string };
    expect(a.payment_method_id).toBe('pm_new_working_card');
    expect(a.reauth_count).toBe(1);
    expect(a.authorization_status).toBe('captured');

    const { data: payRow } = await db
      .from('payments')
      .select('status, charge_kind')
      .eq('appointment_id', appt.id)
      .single();
    expect((payRow as { status: string }).status).toBe('paid');
    expect((payRow as { charge_kind: string }).charge_kind).toBe('completion');
  });

  it('payment_intent.succeeded for a COMPLETION charge on a cancelled job refunds instead of settling', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'cancelled',
      totalPrice: 100,
    });
    // The in-flight ACH debit, initiated before the cancel.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'processing',
      payment_method: 'ach',
      payment_type: 'revenue',
      charge_kind: 'completion',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const { status } = await postEvent(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 100,
        onBehalfOf: 'acct_tenant_recov',
        extraMetadata: { charge_kind: 'completion' },
      }),
    );
    expect(status).toBe(200);

    // Refund issued, never settled: no transfers to tenant or cleaner. The first attempt uses
    // attempt counter 0 (a failed refund bumps it for a fresh key).
    expect(vi.mocked(createRefund)).toHaveBeenCalledTimes(1);
    const refundArg = vi.mocked(createRefund).mock.calls[0][0] as { idempotencyKey?: string };
    expect(refundArg.idempotencyKey).toBe(`cancelrefund-${appt.id}-0`);
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    // The payment stays 'paid' until charge.refunded CONFIRMS the refund; the pending refunds
    // row is what gates re-entry meanwhile.
    const { data: payRow } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payRow as { status: string }).status).toBe('paid');

    const { data: refundRows } = await db
      .from('refunds')
      .select('amount, initiator_user_id, status, reason')
      .eq('appointment_id', appt.id);
    expect(refundRows).toHaveLength(1);
    const r = refundRows![0] as { amount: number; initiator_user_id: string | null; status: string; reason: string };
    expect(Number(r.amount)).toBe(10000);
    expect(r.initiator_user_id).toBeNull();
    expect(r.status).toBe('pending');
    expect(r.reason).toBe('cancelled_inflight_debit');

    const { data: events } = await db.from('payment_events').select('event_type').eq('appointment_id', appt.id);
    expect((events ?? []).some((e) => (e as { event_type: string }).event_type === 'cancelled_inflight_refunded')).toBe(true);

    // Admin notification recorded.
    const { data: notifs } = await db
      .from('notification_events')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cancelled_job_refunded');
    expect((notifs ?? []).length).toBeGreaterThan(0);

    // A replayed delivery (new event id, same PI) short-circuits on the pending refund: no
    // second refund, no transfers.
    const replay = await postEvent(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 100,
        eventId: `evt_replay_${appt.id}`,
        onBehalfOf: 'acct_tenant_recov',
        extraMetadata: { charge_kind: 'completion' },
      }),
    );
    expect(replay.status).toBe(200);
    expect(vi.mocked(createRefund)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();
  });

  it('the CANCELLATION FEE charge on a cancelled job still settles to the tenant (no refund)', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'cancelled',
      totalPrice: 100,
    });
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 20,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      charge_kind: 'cancellation_fee',
      stripe_payment_intent_id: `pi_test_${appt.id}`,
    });

    const { status } = await postEvent(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 20,
        onBehalfOf: 'acct_tenant_recov',
        extraMetadata: { charge_kind: 'cancellation_fee' },
      }),
    );
    expect(status).toBe(200);

    expect(vi.mocked(createRefund)).not.toHaveBeenCalled();
    // The fee settles to the tenant only (the cleaner is never paid for a cancelled job).
    expect(vi.mocked(createPlatformTransfer)).toHaveBeenCalledTimes(1);
    const transferArg = vi.mocked(createPlatformTransfer).mock.calls[0][0] as { idempotencyKey: string };
    expect(transferArg.idempotencyKey).toBe(`tenant-payout-${appt.id}`);

    const { data: payRow } = await db
      .from('payments')
      .select('status')
      .eq('appointment_id', appt.id)
      .single();
    expect((payRow as { status: string }).status).toBe('paid');
  });

  it('migration 088: a second Stripe-backed revenue row for the same appointment is rejected (23505)', async () => {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const base = {
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      payment_method: 'card',
      payment_type: 'revenue',
    };
    const first = await db
      .from('payments')
      .insert({ ...base, status: 'paid', stripe_payment_intent_id: `pi_uniq_a_${randomUUID()}` });
    expect(first.error).toBeNull();

    const second = await db
      .from('payments')
      .insert({ ...base, status: 'processing', stripe_payment_intent_id: `pi_uniq_b_${randomUUID()}` });
    expect(second.error?.code).toBe('23505');

    // A manual cash record (no PaymentIntent) still coexists — it's outside the partial index.
    const manual = await db.from('payments').insert({ ...base, status: 'paid', payment_method: 'manual' });
    expect(manual.error).toBeNull();
  });
});
