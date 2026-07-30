import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * triggerPayRequestSettlement's settled path: a thread approved AFTER the
 * completion charge captured (the counter-negotiation flow) must settle by
 * riding the charge itself. The walkthrough failure this guards: the trigger
 * used to pass a null charge id, so both transfer legs drew on the platform's
 * AVAILABLE balance (just accumulated platform fees) instead of the captured
 * charge's pending funds, and a $75 negotiated payout bounced with
 * insufficient_funds while the $80 charge sat right there.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveCharge: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
}));

vi.mock('@/lib/stripe/transfers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/transfers')>();
  return {
    ...actual,
    createPlatformTransfer: vi.fn(
      async (p: { destinationAccountId: string; amountCents: number; appointmentId: string }) => ({
        id: `tr_${p.appointmentId}_${p.destinationAccountId}`,
        amount: p.amountCents,
      }),
    ),
    listTransfersByGroup: vi.fn(async () => []),
    reversePlatformTransfer: vi.fn(async () => ({ id: 'trr_test' })),
    retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 0, amount_reversed: 0 })),
  };
});

import { triggerPayRequestSettlement } from './actOnPayRequest';
import { retrieveCharge, retrievePaymentIntent } from '@/lib/stripe/reconcile';
import { createPlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

describe('triggerPayRequestSettlement — settles on the captured charge', () => {
  let org: TestOrgFixture;
  let tenantAcct: string;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      cleanerPayoutModel: 'request',
      stripeConnectAccountId: 'acct_cleaner_trigger',
      stripeConnectOnboardingComplete: true,
      platformFeeBps: 100,
    });
    const db = createTestSupabaseClient();
    tenantAcct = `acct_tenant_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: tenantAcct, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(retrieveCharge).mockReset();
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 0 } as Stripe.Charge);
    vi.mocked(retrievePaymentIntent).mockReset();
    vi.mocked(retrievePaymentIntent).mockImplementation(
      async (piId: string) =>
        ({ id: piId, latest_charge: piId.replace('pi_', 'ch_') }) as unknown as Stripe.PaymentIntent,
    );
    vi.mocked(listTransfersByGroup).mockReset();
    vi.mocked(listTransfersByGroup).mockResolvedValue([]);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /** The walkthrough scenario: $80 job captured, thread approved at $75 via counter. */
  async function seedApprovedJob() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 80,
    });
    const { error } = await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 80,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_${appt.id}`,
      captured_at: new Date().toISOString(),
    });
    if (error) throw new Error(`payment seed failed: ${error.message}`);
    const pr = await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'approved',
      jobPriceCents: 8000,
      approvedAmountCents: 7500,
      offers: [
        { actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 10000 },
        { actor: 'org', actorUserId: org.admin.userId, amountCents: 7500 },
      ],
    });
    return { db, apptId: appt.id, prId: pr.id };
  }

  it('passes the resolved charge as source_transaction on BOTH transfer legs', async () => {
    const { db, apptId, prId } = await seedApprovedJob();

    const outcome = await triggerPayRequestSettlement(db, apptId, 'user:test');
    expect(outcome).toBe('settled');
    expect(vi.mocked(retrievePaymentIntent)).toHaveBeenCalledWith(`pi_${apptId}`);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    const cleanerLeg = calls.find((c) => c.destinationAccountId === 'acct_cleaner_trigger');
    const tenantLeg = calls.find((c) => c.destinationAccountId === tenantAcct);
    expect(cleanerLeg).toBeDefined();
    expect(tenantLeg).toBeDefined();
    // The point of the fix: both legs ride the captured charge.
    expect(cleanerLeg!.sourceTransactionId).toBe(`ch_${apptId}`);
    expect(tenantLeg!.sourceTransactionId).toBe(`ch_${apptId}`);
    // The approved amount is the cleaner's money; the tenant gets what remains
    // after the cleaner and the 1% platform fee (8000 - 7500 - 80).
    expect(cleanerLeg!.amountCents).toBe(7500);
    expect(tenantLeg!.amountCents).toBe(420);

    const { data: payout } = await db
      .from('payouts')
      .select('amount, status, payout_model_snapshot, pay_request_id')
      .eq('appointment_id', apptId)
      .single();
    const row = payout as Record<string, unknown>;
    expect(Number(row.amount)).toBe(75);
    expect(row.status).toBe('paid');
    expect(row.payout_model_snapshot).toBe('request');
    expect(row.pay_request_id).toBe(prId);
  });

  it('still settles (balance-funded) when the charge cannot be resolved', async () => {
    const { db, apptId } = await seedApprovedJob();
    vi.mocked(retrievePaymentIntent).mockRejectedValue(new Error('stripe unreachable'));

    const outcome = await triggerPayRequestSettlement(db, apptId, 'user:test');
    expect(outcome).toBe('settled');

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThan(0);
    // Fallback keeps the old semantics: no source, draws on available balance.
    for (const c of calls) expect(c.sourceTransactionId).toBeNull();
  });
});
