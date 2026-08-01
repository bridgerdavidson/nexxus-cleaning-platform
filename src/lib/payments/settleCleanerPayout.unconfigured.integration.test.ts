import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

/**
 * Unconfigured-cleaner settlement gate: a cleaner whose pay was never configured
 * (payout_configured_at NULL — their stored mode is only the column default) must
 * defer BOTH legs of settlement, exactly like an unapproved pay request. Nothing
 * may pay the 0% default. transfer_amount stays null so the
 * settleUnsettledCaptures sweep re-selects the row every cycle; once the operator
 * sets the cleaner's pay, the next settle pass moves the money.
 */
vi.mock('@/lib/stripe/reconcile', () => ({
  retrieveCharge: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  listRefundsForPaymentIntent: vi.fn(async () => []),
}));

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
  retrievePlatformTransfer: vi.fn(async (id: string) => ({ id, amount: 0, amount_reversed: 0 })),
}));

import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { retrieveCharge } from '@/lib/stripe/reconcile';
import { createPlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';

describe('settleCleanerPayout — unconfigured cleaner defers both legs', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_unconf',
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
      platformFeeBps: 0,
      cleanerPayConfigured: false,
    });
    const db = createTestSupabaseClient();
    // Tenant (org) must be a ready connected account or settlement bails earlier.
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: `acct_tenant_${org.organizationId.slice(0, 12)}`,
        stripe_connect_charges_enabled: true,
      })
      .eq('id', org.organizationId);
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(retrieveCharge).mockReset();
    vi.mocked(retrieveCharge).mockResolvedValue({ amount_refunded: 0 } as Stripe.Charge);
    vi.mocked(listTransfersByGroup).mockReset();
    vi.mocked(listTransfersByGroup).mockResolvedValue([]);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  /** $100 captured completion charge, revenue row committed, nothing settled yet. */
  async function seedCapturedJob() {
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const { error } = await db.from('payments').insert({
      organization_id: org.organizationId,
      appointment_id: appt.id,
      amount: 100,
      status: 'paid',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: `pi_${appt.id}`,
    });
    if (error) throw new Error(`payment seed failed: ${error.message}`);
    return { db, apptId: appt.id };
  }

  it('defers with no transfers, leaves the row sweep-visible, and writes the forensic marker', async () => {
    const { db, apptId } = await seedCapturedJob();

    const res = await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(res.settled).toBe(false);
    expect(res.reason).toBe('cleaner_pay_not_configured');

    // NEITHER leg moved: the tenant remainder depends on the cleaner amount.
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    // transfer_amount stays null → settleUnsettledCaptures re-selects it next sweep.
    const { data: pay } = await db
      .from('payments')
      .select('transfer_amount')
      .eq('appointment_id', apptId)
      .single();
    expect((pay as { transfer_amount: number | null }).transfer_amount).toBeNull();

    // No payout row was carved for the 0% default.
    const { data: payouts } = await db.from('payouts').select('id').eq('appointment_id', apptId);
    expect(payouts).toEqual([]);

    // Webhook path (capturedCents passed) writes the deferral marker once.
    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', apptId)
      .eq('event_type', 'settlement_deferred_pay_not_configured');
    expect(events).toHaveLength(1);
  });

  it('the sweep path (no capturedCents) defers silently, without spamming the ledger', async () => {
    const { db, apptId } = await seedCapturedJob();

    const res = await settleCleanerPayout(db, apptId, null);
    expect(res).toEqual({ settled: false, reason: 'cleaner_pay_not_configured' });

    const { data: events } = await db
      .from('payment_events')
      .select('event_type')
      .eq('appointment_id', apptId)
      .eq('event_type', 'settlement_deferred_pay_not_configured');
    expect(events).toEqual([]);
  });

  it('settles both legs on the first pass after the operator sets pay', async () => {
    const { db, apptId } = await seedCapturedJob();
    await settleCleanerPayout(db, apptId, `ch_${apptId}`, 10000);
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    // The operator sets their pay (percentage 60, as update-cleaner would).
    await db
      .from('cleaner_profiles')
      .update({ payout_configured_at: new Date().toISOString() })
      .eq('id', org.cleaner.userId);

    // The next sweep pass settles: tenant $40 + cleaner $60 of the $100 (0 fee, 0 bps).
    const res = await settleCleanerPayout(db, apptId, null);
    expect(res.settled).toBe(true);

    const calls = vi.mocked(createPlatformTransfer).mock.calls.map((c) => c[0]);
    const cleanerCall = calls.find((c) => c.destinationAccountId === 'acct_cleaner_unconf');
    const tenantCall = calls.find((c) => c.destinationAccountId !== 'acct_cleaner_unconf');
    expect(cleanerCall?.amountCents).toBe(6000);
    expect(tenantCall?.amountCents).toBe(4000);

    const { data: payout } = await db
      .from('payouts')
      .select('status, amount, payout_model_snapshot')
      .eq('appointment_id', apptId)
      .single();
    expect((payout as { status: string }).status).toBe('paid');
    expect(Number((payout as { amount: number }).amount)).toBe(60);
    expect((payout as { payout_model_snapshot: string }).payout_model_snapshot).toBe('percentage');
  });
});
