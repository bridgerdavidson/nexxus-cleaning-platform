import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * chargeUncollectedCompletions: the reconcile sweep that charges completed jobs whose
 * completion charge never ran (flags off at completion, a 502 mid-charge, a dead client).
 * Sibling of route.integration.test.ts: tested directly with staleMinutes 0 because the
 * route's default 30-minute SLA can't be crossed by freshly-seeded rows.
 */
vi.mock('@/lib/stripe/charges/charge', () => ({
  createDestinationCharge: vi.fn(async (p: { appointmentId: string }) => ({
    id: `pi_sweep_${p.appointmentId}`,
    status: 'succeeded',
  })),
}));

vi.mock('@/lib/stripe/customers/homeowner', () => ({
  getPaymentMethodType: vi.fn(async () => 'card'),
  paymentMethodBelongsToCustomer: vi.fn(async () => true),
  listSavedCards: vi.fn(async () => []),
}));

import { chargeUncollectedCompletions } from '@/lib/payments/reconcile';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('chargeUncollectedCompletions (reconcile sweep)', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    org = await withTestOrg({
      stripeConnectAccountId: 'acct_cleaner_sweep',
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
      .update({ stripe_customer_id: 'cus_ho_sweep' })
      .eq('id', org.homeowner.userId);
    vi.mocked(createDestinationCharge).mockClear();
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  async function seedCompleted(opts: { authorizationStatus?: string | null; withProcessingRow?: boolean } = {}) {
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
      .update({ payment_method_id: 'pm_sweep_card', authorization_status: opts.authorizationStatus ?? null })
      .eq('id', appt.id);
    if (opts.withProcessingRow) {
      await db.from('payments').insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        status: 'processing',
        payment_method: 'ach',
        payment_type: 'revenue',
        charge_kind: 'completion',
        stripe_payment_intent_id: `pi_inflight_${appt.id}`,
      });
    }
    return appt;
  }

  it('charges a completed job that was never charged, exactly once', async () => {
    const db = createTestSupabaseClient();
    const appt = await seedCompleted();

    const result = await chargeUncollectedCompletions(db, { staleMinutes: 0, organizationId: org.organizationId });
    expect(result.charged).toBe(1);
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);

    const { data: payRow } = await db
      .from('payments')
      .select('status, charge_kind')
      .eq('appointment_id', appt.id)
      .single();
    expect((payRow as { status: string }).status).toBe('paid');
    expect((payRow as { charge_kind: string }).charge_kind).toBe('completion');

    // Second sweep: the paid row short-circuits, no second charge.
    const again = await chargeUncollectedCompletions(db, { staleMinutes: 0, organizationId: org.organizationId });
    expect(again.charged).toBe(0);
    expect(vi.mocked(createDestinationCharge)).toHaveBeenCalledTimes(1);
  });

  it('skips a declined job (authorization_status=failed) so a dead card is never hammered', async () => {
    const db = createTestSupabaseClient();
    await seedCompleted({ authorizationStatus: 'failed' });

    const result = await chargeUncollectedCompletions(db, { staleMinutes: 0, organizationId: org.organizationId });
    expect(result.charged).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('skips a job whose debit is already in flight (processing revenue row)', async () => {
    const db = createTestSupabaseClient();
    await seedCompleted({ withProcessingRow: true });

    const result = await chargeUncollectedCompletions(db, { staleMinutes: 0, organizationId: org.organizationId });
    expect(result.charged).toBe(0);
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });

  it('no-ops entirely when the new charge flow flag is off', async () => {
    const db = createTestSupabaseClient();
    await seedCompleted();
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';

    const result = await chargeUncollectedCompletions(db, { staleMinutes: 0, organizationId: org.organizationId });
    expect(result).toEqual({ checked: 0, charged: 0 });
    expect(vi.mocked(createDestinationCharge)).not.toHaveBeenCalled();
  });
});
