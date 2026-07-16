import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  createTestAppointment,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import type { PlatformStats } from '@/types/platform';

const METRIC_KEYS: (keyof PlatformStats)[] = [
  'tenants',
  'active_plans',
  'trialing',
  'payments_ready',
  'platform_fees_cents',
  'gmv_cents',
  'total_appointments',
  'new_tenants_30d',
];

async function fetchStats(token: string): Promise<PlatformStats> {
  const { status, body } = await callRoute<{ stats: PlatformStats }>(GET, {
    method: 'GET',
    headers: bearerHeader(token),
  });
  expect(status).toBe(200);
  return body.stats;
}

/**
 * Remove the payment/fee/appointment rows a test seeds, in FK-safe order, so the
 * org teardown (which does not CASCADE these NO-CASCADE tables) can drop cleanly
 * and the seeded money never pollutes another run's global aggregates.
 */
async function wipeOrgFinancials(organizationId: string): Promise<void> {
  const db = createTestSupabaseClient();
  await db.from('application_fees').delete().eq('organization_id', organizationId);
  await db.from('payments').delete().eq('organization_id', organizationId);
  await db.from('appointments').delete().eq('organization_id', organizationId);
  await db.from('properties').delete().eq('organization_id', organizationId);
  await db.from('service_types').delete().eq('organization_id', organizationId);
}

describe('GET /api/platform/stats', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    if (org) await wipeOrgFinancials(org.organizationId);
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('returns 401 without a token', async () => {
    const { status } = await callRoute(GET, { method: 'GET' });
    expect(status).toBe(401);
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns the full metric shape (all numbers) for a platform admin', async () => {
    admin = await withPlatformAdmin();
    const stats = await fetchStats(admin.accessToken);
    for (const k of METRIC_KEYS) {
      expect(typeof stats[k]).toBe('number');
      expect(Number.isFinite(stats[k])).toBe(true);
    }
  });

  it('reflects a new tenant, appointment, paid revenue, and net platform fee in the deltas', async () => {
    admin = await withPlatformAdmin();
    const before = await fetchStats(admin.accessToken);

    org = await withTestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      totalPrice: 100,
      status: 'completed',
    });

    const db = createTestSupabaseClient();
    // A paid revenue payment of $100.00 -> +10000 cents GMV.
    const { data: pay, error: payErr } = await db
      .from('payments')
      .insert({
        appointment_id: appt.id,
        organization_id: org.organizationId,
        amount: 100,
        status: 'paid',
        payment_type: 'revenue',
        paid_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(payErr).toBeNull();

    // A $5.00 platform fee (500 cents) with $1.00 refunded -> +400 cents net.
    const { error: feeErr } = await db.from('application_fees').insert({
      organization_id: org.organizationId,
      payment_id: (pay as { id: string }).id,
      stripe_application_fee_id: `fee_test_${appt.id}`,
      amount: 500,
      bps_applied: 250,
      refunded_amount: 100,
    });
    expect(feeErr).toBeNull();

    const after = await fetchStats(admin.accessToken);

    expect(after.tenants).toBe(before.tenants + 1);
    expect(after.new_tenants_30d).toBe(before.new_tenants_30d + 1);
    expect(after.total_appointments).toBe(before.total_appointments + 1);
    expect(after.gmv_cents).toBe(before.gmv_cents + 10000);
    expect(after.platform_fees_cents).toBe(before.platform_fees_cents + 400);
  });

  it('excludes non-paid and non-revenue payments from GMV', async () => {
    admin = await withPlatformAdmin();
    const before = await fetchStats(admin.accessToken);

    org = await withTestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });
    const db = createTestSupabaseClient();
    await db.from('payments').insert([
      // pending (not collected) -> excluded from GMV
      {
        appointment_id: appt.id,
        organization_id: org.organizationId,
        amount: 50,
        status: 'pending',
        payment_type: 'revenue',
      },
      // paid but a refund (not revenue) -> excluded from GMV
      {
        appointment_id: appt.id,
        organization_id: org.organizationId,
        amount: 70,
        status: 'paid',
        payment_type: 'refund',
      },
    ]);

    const after = await fetchStats(admin.accessToken);
    expect(after.gmv_cents).toBe(before.gmv_cents);
  });
});
