import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * T2-1: the homeowner is proactively told about money that moves on their card. The render half
 * (bell copy + toast) already ships; these tests pin the EMIT half at each real call site, driven
 * through the production function (never by calling the notify helpers directly, which would
 * happily pass while the caller wiring is wrong).
 *
 * Contract under test: docs/redesign/2026-07-27-t2-1-homeowner-money-events-contract.md
 */
vi.mock('@/lib/payments/settleCleanerPayout', () => ({
  settleCleanerPayout: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(),
}));
vi.mock('@/lib/stripe/charges/refund', () => ({
  createRefund: vi.fn(async () => ({ id: `re_t21_${crypto.randomUUID()}` })),
}));
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getPaymentMethodType: vi.fn(async () => 'card'),
  paymentMethodBelongsToCustomer: vi.fn(async () => true),
  getDefaultPaymentMethod: vi.fn(async () => null),
  listSavedCards: vi.fn(async () => []),
}));

import { dispatchStripeEvent } from '@/lib/payments/dispatchStripeEvent';
import { chargeCancellationFee } from '@/lib/payments/chargeCancellationFee';
import { refundCancelledInflightCharge } from '@/lib/payments/refundCancelledCharge';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

const db = createTestSupabaseClient();

/** The homeowner-audience rows for one appointment. */
async function notificationsFor(appointmentId: string, eventType: string) {
  const { data } = await db
    .from('notification_events')
    .select('event_type, recipient_user_id, payload, appointment_id')
    .eq('appointment_id', appointmentId)
    .eq('event_type', eventType);
  return (data ?? []) as Array<{
    event_type: string;
    recipient_user_id: string;
    payload: Record<string, unknown>;
    appointment_id: string;
  }>;
}

function succeededIntent(
  appointmentId: string,
  organizationId: string,
  opts: { id?: string; amountReceived?: number; selfPay?: boolean } = {},
): Stripe.Event {
  const pi = {
    id: opts.id ?? `pi_t21_${crypto.randomUUID()}`,
    object: 'payment_intent',
    amount: opts.amountReceived ?? 12389,
    amount_received: opts.amountReceived ?? 12389,
    status: 'succeeded',
    latest_charge: `ch_t21_${crypto.randomUUID()}`,
    // Production shape: tenant is merchant of record, funds land on the platform balance.
    on_behalf_of: 'acct_tenant_t21',
    metadata: {
      appointment_id: appointmentId,
      organization_id: organizationId,
      charge_kind: 'completion',
      ...(opts.selfPay ? { self_pay: 'true' } : {}),
    },
  };
  return {
    id: `evt_t21_${crypto.randomUUID()}`,
    type: 'payment_intent.succeeded',
    data: { object: pi },
  } as unknown as Stripe.Event;
}

describe('T2-1 charge_succeeded — the completion-charge receipt', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });
  afterEach(async () => org.cleanup());

  it('notifies the homeowner when the completion charge succeeds', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 120,
    });

    await dispatchStripeEvent(db, succeededIntent(appt.id, org.organizationId));

    const rows = await notificationsFor(appt.id, 'charge_succeeded');
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(org.homeowner.userId);
    // The amount that actually hit the card (gross + passthrough fee), not the job's list price.
    expect(rows[0].payload.amount_cents).toBe(12389);
    expect(rows[0].payload.audience).toBe('homeowner');
    // Denormalized context the label renders without a join.
    expect(rows[0].payload.property_label).toBeTruthy();
  });

  it('is idempotent across a webhook redelivery of the same PaymentIntent', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 120,
    });
    const event = succeededIntent(appt.id, org.organizationId);

    await dispatchStripeEvent(db, event);
    await dispatchStripeEvent(db, event);

    expect(await notificationsFor(appt.id, 'charge_succeeded')).toHaveLength(1);
  });

  it('does not notify on a self-pay charge (the org is the payer, not a homeowner)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 120,
      selfPay: true,
    });

    await dispatchStripeEvent(
      db,
      succeededIntent(appt.id, org.organizationId, { selfPay: true }),
    );

    expect(await notificationsFor(appt.id, 'charge_succeeded')).toHaveLength(0);
  });

  it('does not notify when the charge settled after a cancel (it gets refunded, not receipted)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'cancelled',
      totalPrice: 120,
    });

    await dispatchStripeEvent(db, succeededIntent(appt.id, org.organizationId));

    expect(await notificationsFor(appt.id, 'charge_succeeded')).toHaveLength(0);
  });
});

describe('T2-1 cancellation_fee_charged — the off-session fee record', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({ platformFeeBps: 0 });
    // The fee charge routes through the TENANT as merchant of record, so the org needs a
    // charges-enabled Connect account or the helper bails 'uncollectable' before charging.
    // The account id must be unique per test: organizations.stripe_connect_account_id carries a
    // partial UNIQUE index, and this DB is shared, so a constant id silently loses the update
    // (23505) to any leftover org from an earlier run and the fee then reads as uncollectable.
    const { error: connectErr } = await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_t21${crypto.randomUUID().replace(/-/g, '')}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    if (connectErr) throw new Error(`tenant Connect setup failed: ${connectErr.message}`);
    vi.mocked(createDestinationCharge).mockReset();
  });
  afterEach(async () => org.cleanup());

  async function seedFeeChargeable() {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'cancelled',
      totalPrice: 120,
    });
    await db.from('appointments').update({ payment_method_id: 'pm_t21' }).eq('id', appt.id);
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: `cus_t21_${crypto.randomUUID()}` })
      .eq('id', org.homeowner.userId);
    vi.mocked(createDestinationCharge).mockResolvedValue({
      id: `pi_fee_${crypto.randomUUID()}`,
      status: 'succeeded',
    } as unknown as Stripe.PaymentIntent);
    return appt;
  }

  it('notifies the homeowner with the no-show wording when the fee is charged', async () => {
    const appt = await seedFeeChargeable();

    const outcome = await chargeCancellationFee(
      db,
      {
        id: appt.id,
        organization_id: org.organizationId,
        homeowner_id: org.homeowner.userId,
        payment_method_id: 'pm_t21',
        reauth_count: 0,
      },
      4000,
      'user:tester',
      { party: 'homeowner', noShow: true, insideWindow: true },
    );
    expect(outcome.code).toBe('charged');

    const rows = await notificationsFor(appt.id, 'cancellation_fee_charged');
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(org.homeowner.userId);
    expect(rows[0].payload.amount_cents).toBe(4000);
    expect(rows[0].payload.reason).toBe('no_show');
  });

  it('re-notifies on a retry that short-circuits on the captured fee row (crash-before-notify recovery)', async () => {
    const appt = await seedFeeChargeable();
    const feeArgs = {
      id: appt.id,
      organization_id: org.organizationId,
      homeowner_id: org.homeowner.userId,
      payment_method_id: 'pm_t21',
      reauth_count: 0,
    };
    await chargeCancellationFee(db, feeArgs, 4000, 'user:tester', {
      party: 'homeowner',
      noShow: false,
      insideWindow: true,
    });
    // Simulate the crash-before-notify window: the fee row is captured, the bell row is not there.
    await db.from('notification_events').delete().eq('appointment_id', appt.id);

    const retry = await chargeCancellationFee(db, feeArgs, 4000, 'user:tester', {
      party: 'homeowner',
      noShow: false,
      insideWindow: true,
    });

    expect(retry.code).toBe('charged');
    // No second card charge, and the missing notification is recovered.
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
    expect(await notificationsFor(appt.id, 'cancellation_fee_charged')).toHaveLength(1);
  });

  it('does not announce a paid COMPLETION charge as a cancellation fee', async () => {
    const appt = await seedFeeChargeable();
    // A captured completion charge is the newest revenue row, so the fee helper short-circuits on
    // it. That must not tell the homeowner they were charged a fee.
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 120,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      charge_kind: 'completion',
      stripe_payment_intent_id: `pi_completion_${crypto.randomUUID()}`,
    });

    const outcome = await chargeCancellationFee(
      db,
      {
        id: appt.id,
        organization_id: org.organizationId,
        homeowner_id: org.homeowner.userId,
        payment_method_id: 'pm_t21',
        reauth_count: 0,
      },
      4000,
      'user:tester',
      { party: 'homeowner', noShow: true, insideWindow: true },
    );

    expect(outcome.code).toBe('charged');
    expect(await notificationsFor(appt.id, 'cancellation_fee_charged')).toHaveLength(0);
  });

  it('uses the cancellation wording for a late cancel, and does not notify on a decline', async () => {
    const appt = await seedFeeChargeable();
    const lateCancel = await chargeCancellationFee(
      db,
      {
        id: appt.id,
        organization_id: org.organizationId,
        homeowner_id: org.homeowner.userId,
        payment_method_id: 'pm_t21',
        reauth_count: 0,
      },
      2500,
      'user:tester',
      { party: 'homeowner', noShow: false, insideWindow: true },
    );
    expect(lateCancel.code).toBe('charged');
    const charged = await notificationsFor(appt.id, 'cancellation_fee_charged');
    expect(charged).toHaveLength(1);
    expect(charged[0].payload.reason).toBe('cancellation');

    // A declined fee must not tell the homeowner they were charged.
    const declined = await seedFeeChargeable();
    vi.mocked(createDestinationCharge).mockRejectedValueOnce(new Error('Your card was declined'));
    const outcome = await chargeCancellationFee(
      db,
      {
        id: declined.id,
        organization_id: org.organizationId,
        homeowner_id: org.homeowner.userId,
        payment_method_id: 'pm_t21',
        reauth_count: 0,
      },
      2500,
      'user:tester',
      { party: 'homeowner', noShow: false, insideWindow: true },
    );
    expect(outcome.code).toBe('failed');
    expect(await notificationsFor(declined.id, 'cancellation_fee_charged')).toHaveLength(0);
  });
});

describe('T2-1 refund_issued — the auto-refund of a cancelled job debit', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });
  afterEach(async () => org.cleanup());

  async function seedPaidDebit(selfPay = false) {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'cancelled',
      totalPrice: 120,
      selfPay,
    });
    const piId = `pi_refund_${crypto.randomUUID()}`;
    await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 120,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: piId,
    });
    return { appt, piId };
  }

  it('notifies the homeowner that a refund is on the way', async () => {
    const { appt, piId } = await seedPaidDebit();

    const result = await refundCancelledInflightCharge(db, {
      appointmentId: appt.id,
      paymentIntentId: piId,
      actor: 'webhook',
    });
    expect(result.refunded).toBe(true);

    const rows = await notificationsFor(appt.id, 'refund_issued');
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(org.homeowner.userId);
    expect(rows[0].payload.amount_cents).toBe(12000);
    expect(rows[0].payload.audience).toBe('homeowner');
  });

  it('does not notify on a self-pay refund (no homeowner payer)', async () => {
    const { appt, piId } = await seedPaidDebit(true);

    await refundCancelledInflightCharge(db, {
      appointmentId: appt.id,
      paymentIntentId: piId,
      actor: 'webhook',
    });

    expect(await notificationsFor(appt.id, 'refund_issued')).toHaveLength(0);
  });
});
