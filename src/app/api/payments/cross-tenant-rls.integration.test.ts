import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

/**
 * Security audit C4: the consolidated SELECT policies carried an UNSCOPED
 * `app_metadata.role IN ('admin','manager')` branch, so any tenant admin/manager
 * could read every other tenant's payments (and appointments/messages/user_profiles).
 * `cleaner_profiles` was worse: `USING (true)` for `public`, readable by anon.
 *
 * Migration 089 removes those branches. These tests act through anon clients carrying
 * each user's real JWT (the proven RLS-test pattern), so the policy `auth.uid()` /
 * `app_metadata` checks evaluate against the real signed-in user.
 *
 * Note: every fixture admin has `app_metadata.role = 'admin'`. Pre-089 the cross-org
 * reads below would have RETURNED rows via the global-role branch — they must now be empty.
 */
function anonAs(token: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

function anonNoAuth(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

describe('RLS: cross-tenant isolation (audit C4)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let paymentId: string;

  beforeEach(async () => {
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    const db = createTestSupabaseClient();

    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { data: payment, error } = await db
      .from('payments')
      .insert({
        organization_id: org.organizationId,
        appointment_id: appt.id,
        amount: 100,
        payment_method: 'manual',
        payment_type: 'revenue',
        status: 'paid',
      })
      .select('id')
      .single();
    if (error || !payment) throw new Error(`seed payment failed: ${error?.message}`);
    paymentId = payment.id as string;
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  // ── payments ────────────────────────────────────────────────────────────────
  it("org's own admin can read the org's payment", async () => {
    const { data } = await anonAs(org.admin.accessToken)
      .from('payments')
      .select('id')
      .eq('id', paymentId);
    expect((data ?? []).length).toBe(1);
  });

  it("a DIFFERENT org's admin CANNOT read the payment (global-role leak closed)", async () => {
    const { data } = await anonAs(org2.admin.accessToken)
      .from('payments')
      .select('id')
      .eq('id', paymentId);
    expect((data ?? []).length).toBe(0);
  });

  // ── cleaner_profiles ─────────────────────────────────────────────────────────
  it('anon (no auth) CANNOT read cleaner_profiles (was USING(true) for public)', async () => {
    const { data } = await anonNoAuth()
      .from('cleaner_profiles')
      .select('id')
      .eq('id', org.cleaner.userId);
    expect((data ?? []).length).toBe(0);
  });

  it("a different org's admin CANNOT read the org's cleaner_profiles", async () => {
    const { data } = await anonAs(org2.admin.accessToken)
      .from('cleaner_profiles')
      .select('id, stripe_connect_account_id, payout_percent')
      .eq('id', org.cleaner.userId);
    expect((data ?? []).length).toBe(0);
  });

  it("the org's own admin CAN read the org's cleaner_profiles", async () => {
    const { data } = await anonAs(org.admin.accessToken)
      .from('cleaner_profiles')
      .select('id')
      .eq('id', org.cleaner.userId);
    expect((data ?? []).length).toBe(1);
  });

  it('sanity: the service-role client bypasses RLS and sees the payment', async () => {
    const db = createTestSupabaseClient();
    const { data } = await db.from('payments').select('id').eq('id', paymentId);
    expect((data ?? []).length).toBe(1);
  });
});
