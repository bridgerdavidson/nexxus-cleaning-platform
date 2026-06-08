import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

// settleCleanerPayout is the only Stripe-touching dependency. Mock the transfer module (getStripe
// is stubbed to throw by the global integration setup); the split math + ledger + DB writes run
// for real. transferGroupFor is pure but lives in the same module, so re-export it from the mock.
vi.mock('@/lib/stripe/transfers', () => ({
  createPlatformTransfer: vi.fn(async () => ({ id: 'tr_test_retry' })),
  transferGroupFor: (id: string) => `job_${id}`,
}));

import { POST } from './route';
import { createPlatformTransfer } from '@/lib/stripe/transfers';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (payoutId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ payoutId }) });

describe('POST /api/payouts/:payoutId/retry', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    // Onboarded, payout-capable cleaner so settle attempts the real (mocked) transfer.
    org = await withTestOrg({
      stripeConnectAccountId: `acct_cleaner_${randomUUID().slice(0, 8)}`,
      stripeConnectOnboardingComplete: true,
      payoutPercent: 60,
    });
    vi.mocked(createPlatformTransfer).mockClear();
    vi.mocked(createPlatformTransfer).mockResolvedValue({ id: 'tr_test_retry' } as never);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await org.cleanup();
  });

  /** The tenant (org) is a charges-enabled connected account, so the tenant leg can run. */
  async function makeTenantReady() {
    const db = createTestSupabaseClient();
    const acctId = `acct_ready_${org.organizationId.slice(0, 12)}`;
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId, stripe_connect_charges_enabled: true })
      .eq('id', org.organizationId);
    return acctId;
  }

  async function makeAppt(status: 'confirmed' | 'completed' = 'completed') {
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status,
    });
  }

  /** Seed a payout row carved at $60 (60% snapshot) in the given status. */
  async function seedPayout(appointmentId: string, status: string, amount = 60): Promise<string> {
    const db = createTestSupabaseClient();
    const { data, error } = await db
      .from('payouts')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        appointment_id: appointmentId,
        amount,
        payout_percent_snapshot: 60,
        status,
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed payout failed: ${error.message}`);
    return (data as { id: string }).id;
  }

  it('returns 401 with no Authorization header', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('returns 404 when STRIPE_NEW_CHARGE_FLOW_ENABLED is false', async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(404);
  });

  it('rejects a cleaner caller (insufficient role)', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('returns 404 for a payout id that does not exist in the org', async () => {
    const { status } = await callRoute(handlerFor(randomUUID()), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(404);
  });

  it('settles the cleaner using the carved snapshot and flips the row to paid', async () => {
    await makeTenantReady();
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');

    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // The cleaner leg transfers the SNAPSHOT amount ($60 → 6000¢), not a fresh recompute.
    const cleanerCall = vi
      .mocked(createPlatformTransfer)
      .mock.calls.find((c) => c[0].idempotencyKey === `cleaner-payout-${appt.id}`);
    expect(cleanerCall?.[0].amountCents).toBe(6000);

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('payouts')
      .select('status, stripe_transfer_id')
      .eq('id', payoutId)
      .single();
    const payout = row as { status: string; stripe_transfer_id: string | null };
    expect(payout.status).toBe('paid');
    expect(payout.stripe_transfer_id).toBe('tr_test_retry');
  });

  it('surfaces a friendly error and leaves the row failed when settlement cannot run', async () => {
    // Org has no connected account → settle returns tenant_not_ready before any transfer.
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');

    const { status, body } = await callRoute<{ success: boolean; error: string }>(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/payout account isn't connected/i);
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: row } = await db.from('payouts').select('status').eq('id', payoutId).single();
    expect((row as { status: string }).status).toBe('failed');
  });

  it('409 when the payout is already terminal (paid)', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'paid');
    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(409);
    expect(vi.mocked(createPlatformTransfer)).not.toHaveBeenCalled();
  });

  it('403 for a manager WITHOUT can_manage_payments', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const db = createTestSupabaseClient();
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: false,
    });

    const { status, body } = await callRoute<{ error: string }>(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
    expect(body.error).toBe('Requires the Manage Payments permission');
  });

  it('allows a manager WITH can_manage_payments past the permission gate', async () => {
    const appt = await makeAppt();
    const payoutId = await seedPayout(appt.id, 'failed');
    const db = createTestSupabaseClient();
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    await db.from('manager_permissions').insert({
      manager_id: org.homeowner.userId,
      organization_id: org.organizationId,
      can_manage_payments: true,
    });

    const { status } = await callRoute(handlerFor(payoutId), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { organization_id: org.organizationId },
    });
    // Passes role + permission; reaches settle (org not ready → 409), never a 403.
    expect(status).not.toBe(403);
  });
});
