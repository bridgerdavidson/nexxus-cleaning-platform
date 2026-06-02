import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Webhook → settleSelfPay: the correctness backstop for org self-pay.
 *
 * A self-pay payment_intent.succeeded (metadata.self_pay='true', NO on_behalf_of) must take the
 * settleSelfPay branch BEFORE the legacy on_behalf_of / platform-as-merchant branches and pay the
 * cleaner the EXACT cut (a single platform→connected transfer), never a tenant remainder and never
 * via the legacy createConnectTransfer.
 *
 * Per-file mock (composes with the global `@/lib/stripe` mock in integration.setup.ts):
 *   - `@/lib/stripe/transfers` — keep transferGroupFor REAL (it's pure), stub createPlatformTransfer
 *     to record calls and simulate Stripe idempotency (same idempotencyKey → same transfer, no
 *     second push), so we can assert exactly-once across a duplicate delivery.
 *   - reversePlatformTransfer / listTransfersByGroup stubbed (unused on this path but imported by
 *     the dispatcher's dispute handlers).
 */
interface RecordedTransfer {
  destinationAccountId: string;
  amountCents: number;
  sourceTransactionId: string | null;
  idempotencyKey: string;
  appointmentId: string;
  id: string;
}
const platformTransferCalls: RecordedTransfer[] = [];

vi.mock('@/lib/stripe/transfers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/transfers')>();
  return {
    // transferGroupFor is pure — keep the real impl so the group tag matches everywhere.
    transferGroupFor: actual.transferGroupFor,
    createPlatformTransfer: vi.fn(
      async (p: {
        destinationAccountId: string;
        amountCents: number;
        sourceTransactionId: string | null;
        idempotencyKey: string;
        appointmentId: string;
      }) => {
        // Simulate Stripe's idempotency: an existing transfer with the same key is returned, not
        // re-created (so a duplicate webhook delivery never double-pays).
        const existing = platformTransferCalls.find((c) => c.idempotencyKey === p.idempotencyKey);
        if (existing) return { id: existing.id, amount: existing.amountCents };
        const rec: RecordedTransfer = { ...p, id: `tr_selfpay_${p.appointmentId}` };
        platformTransferCalls.push(rec);
        return { id: rec.id, amount: rec.amountCents };
      },
    ),
    listTransfersByGroup: vi.fn(async () => []),
    reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
  };
});

import { POST } from './route';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
import { computeSelfPayAmounts } from '@/lib/payments/selfPayMath';
import { callRoute } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  buildPaymentIntentSucceededEvent,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { signWebhookPayload, type StripeFake } from '../../../../../tests/helpers/stripe';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/stripe/webhook — self-pay settlement', () => {
  let org: TestOrgFixture;
  let fake: StripeFake;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    platformTransferCalls.length = 0;
    fake = globalThis.__stripeFake as StripeFake;
    fake.reset();
    // Cleaner is payout-capable: Connect onboarded, has an account, payout% > 0.
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_selfpay_cleaner',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /** Seed a self-pay appointment (org-owned property, no homeowner) + its pending self-pay charge row. */
  async function seedSelfPay(totalPrice = 100) {
    const admin = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
      totalPrice,
      orgOwnedProperty: true,
      selfPay: true,
    });
    // The authorize step would have written this pending revenue row; the webhook updates it.
    await admin.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: computeSelfPayAmounts({ jobGrossCents: totalPrice * 100, payoutPercent: 60 }).chargeCents / 100,
      status: 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      is_self_pay: true,
      stripe_payment_intent_id: `pi_test_${appt.id}`,
      payment_intent_status: 'requires_capture',
    });
    return appt;
  }

  it('settles a self-pay charge: ONE platform transfer of the cleaner cut, ONE paid self-pay payout, no legacy transfer', async () => {
    const appt = await seedSelfPay(100);
    const { cleanerCutCents } = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 60 });
    expect(cleanerCutCents).toBe(6000); // 60% of $100, floored

    const payload = JSON.stringify(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 200, // grossed-up charge amount — settleSelfPay ignores it and uses the cut
        selfPay: true,
        eventId: `evt_selfpay_${appt.id}`,
      }),
    );
    const sig = signWebhookPayload(payload);

    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': sig },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Exactly one platform transfer, of the EXACT cleaner cut, keyed by selfpay-cleaner-<appt>.
    expect(platformTransferCalls).toHaveLength(1);
    expect(platformTransferCalls[0].amountCents).toBe(cleanerCutCents);
    expect(platformTransferCalls[0].idempotencyKey).toBe(`selfpay-cleaner-${appt.id}`);
    expect(platformTransferCalls[0].destinationAccountId).toBe('acct_selfpay_cleaner');
    // Sourced from the PI's latest_charge (platform balance), not a connected account.
    expect(platformTransferCalls[0].sourceTransactionId).toBe(`ch_test_${appt.id}`);

    // The legacy platform-as-merchant transfer path was NOT taken (proves the self_pay branch ran
    // BEFORE the on_behalf_of fall-through).
    expect(fake.transferCalls).toHaveLength(0);

    // Exactly one payouts row: self-pay, paid, amount = cut/100. No second (tenant-remainder) row.
    const admin = createTestSupabaseClient();
    const { data: payouts } = await admin
      .from('payouts')
      .select('amount, status, is_self_pay, stripe_transfer_id')
      .eq('appointment_id', appt.id);
    expect(payouts).toHaveLength(1);
    const payout = payouts![0] as {
      amount: number;
      status: string;
      is_self_pay: boolean;
      stripe_transfer_id: string | null;
    };
    expect(Number(payout.amount)).toBe(cleanerCutCents / 100);
    expect(payout.status).toBe('paid');
    expect(payout.is_self_pay).toBe(true);
    expect(payout.stripe_transfer_id).toBe(`tr_selfpay_${appt.id}`);

    await admin.from('webhook_events').delete().eq('id', `evt_selfpay_${appt.id}`);
  });

  it('is idempotent: replaying the same self-pay event still yields exactly one transfer and one paid payout', async () => {
    const appt = await seedSelfPay(100);
    const payload = JSON.stringify(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 200,
        selfPay: true,
        eventId: `evt_selfpay_idem_${appt.id}`,
      }),
    );
    const sig = signWebhookPayload(payload);
    const headers = { 'stripe-signature': sig };
    const url = 'http://test.local/api/stripe/webhook';

    const res1 = await callRoute(POST, { method: 'POST', url, headers, body: payload });
    expect(res1.status).toBe(200);
    const res2 = await callRoute(POST, { method: 'POST', url, headers, body: payload });
    expect(res2.status).toBe(200);

    // Second delivery is a webhook_events duplicate (short-circuited before dispatch), but even if
    // it weren't, the selfpay-cleaner-<id> idempotency key + the existing paid-payout guard keep it
    // to exactly one transfer / one payout.
    expect(platformTransferCalls).toHaveLength(1);

    const admin = createTestSupabaseClient();
    const { data: payouts } = await admin
      .from('payouts')
      .select('id, status')
      .eq('appointment_id', appt.id);
    expect(payouts).toHaveLength(1);
    expect((payouts![0] as { status: string }).status).toBe('paid');

    await admin.from('webhook_events').delete().eq('id', `evt_selfpay_idem_${appt.id}`);
  });

  it('records a FAILED self-pay payout (no transfer) when the cleaner is not payout-capable at settlement', async () => {
    const appt = await seedSelfPay(100);
    // Cleaner became unpayable between hold and capture (e.g. onboarding revoked).
    const admin = createTestSupabaseClient();
    await admin
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: false })
      .eq('id', org.cleaner.userId);

    const payload = JSON.stringify(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 200,
        selfPay: true,
        eventId: `evt_selfpay_unpayable_${appt.id}`,
      }),
    );
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200); // settleSelfPay soft-fails; never throws into the webhook

    // No transfer attempted (cleaner not payable); no paid payout. settleSelfPay records the failure
    // in the ledger but does NOT insert a payout row in the not-payable branch.
    expect(platformTransferCalls).toHaveLength(0);
    expect(fake.transferCalls).toHaveLength(0);

    const { data: paidPayouts } = await admin
      .from('payouts')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('status', 'paid');
    expect(paidPayouts ?? []).toHaveLength(0);

    // The forensic ledger captured the not-payable failure.
    const { data: events } = await admin
      .from('payment_events')
      .select('event_type, new_status')
      .eq('appointment_id', appt.id)
      .eq('event_type', 'cleaner_transfer_failed');
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);

    await admin.from('webhook_events').delete().eq('id', `evt_selfpay_unpayable_${appt.id}`);
  });

  it('confirms the call surface of createPlatformTransfer (vi.mocked) for a self-pay settlement', async () => {
    const appt = await seedSelfPay(100);
    const payload = JSON.stringify(
      buildPaymentIntentSucceededEvent({
        appointmentId: appt.id,
        amountDollars: 200,
        selfPay: true,
        eventId: `evt_selfpay_surface_${appt.id}`,
      }),
    );
    const res = await callRoute(POST, {
      method: 'POST',
      url: 'http://test.local/api/stripe/webhook',
      headers: { 'stripe-signature': signWebhookPayload(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    expect(vi.mocked(createPlatformTransfer)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createPlatformTransfer).mock.calls[0][0];
    expect(arg).toMatchObject({
      destinationAccountId: 'acct_selfpay_cleaner',
      amountCents: 6000,
      idempotencyKey: `selfpay-cleaner-${appt.id}`,
      appointmentId: appt.id,
      transferGroup: `appt_${appt.id}`,
    });

    const admin = createTestSupabaseClient();
    await admin.from('webhook_events').delete().eq('id', `evt_selfpay_surface_${appt.id}`);
  });
});
