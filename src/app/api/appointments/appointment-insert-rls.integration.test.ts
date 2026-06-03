import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../tests/helpers/fixtures';

/**
 * Regression for "infinite recursion detected in policy for relation \"appointments\"" — migration 078.
 *
 * The booking modal inserts an appointment from the CLIENT (anon key, RLS enforced). Before 078 the
 * `appointments_insert` WITH CHECK subqueried `user_profiles`, whose own SELECT policy subqueries
 * `appointments` — a policy cycle that Postgres rejects. The self-pay path always tripped it
 * (homeowner_id IS NULL ⇒ the `auth.uid() = homeowner_id` branch is false, so the user_profiles
 * branch is always evaluated), but it affects any actor that is not the homeowner.
 *
 * These tests act through an anon client carrying the user's own JWT, so the insert hits real RLS
 * (the service-role fixtures bypass it, which is why the original integration suite missed this).
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

describe('RLS: appointments INSERT does not recurse (migration 078)', () => {
  let org: TestOrgFixture;
  let orgOwnedPropertyId: string;
  let serviceTypeId: string;

  beforeEach(async () => {
    org = await withTestOrg();
    // Seed an org-owned property + a service type (service role bypasses RLS).
    const seed = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      orgOwnedProperty: true,
      selfPay: true,
    });
    orgOwnedPropertyId = seed.propertyId;
    serviceTypeId = seed.serviceTypeId;
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('admin inserts a SELF-PAY appointment (homeowner_id null) via the anon client without RLS recursion', async () => {
    const { data, error } = await anonAs(org.admin.accessToken)
      .from('appointments')
      .insert({
        organization_id: org.organizationId,
        property_id: orgOwnedPropertyId,
        service_type_id: serviceTypeId,
        cleaner_id: org.cleaner.userId,
        homeowner_id: null,
        is_self_pay: true,
        scheduled_date: '2026-07-01',
        scheduled_time: '10:00',
        duration_minutes: 60,
        total_price: 100,
        status: 'pending',
      })
      .select('id')
      .maybeSingle();

    // Before migration 078: error.message === 'infinite recursion detected in policy for relation "appointments"'
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('admin inserts a normal homeowner-billed appointment via the anon client (legacy path unaffected)', async () => {
    const { data, error } = await anonAs(org.admin.accessToken)
      .from('appointments')
      .insert({
        organization_id: org.organizationId,
        property_id: orgOwnedPropertyId,
        service_type_id: serviceTypeId,
        cleaner_id: org.cleaner.userId,
        homeowner_id: org.homeowner.userId,
        is_self_pay: false,
        scheduled_date: '2026-07-02',
        scheduled_time: '11:00',
        duration_minutes: 60,
        total_price: 100,
        status: 'pending',
      })
      .select('id')
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('an unrelated homeowner (different org) CANNOT insert an appointment into this org', async () => {
    const other = await withTestOrg();
    try {
      const { error } = await anonAs(other.homeowner.accessToken)
        .from('appointments')
        .insert({
          organization_id: org.organizationId,
          property_id: orgOwnedPropertyId,
          service_type_id: serviceTypeId,
          cleaner_id: org.cleaner.userId,
          homeowner_id: null,
          is_self_pay: true,
          scheduled_date: '2026-07-03',
          scheduled_time: '12:00',
          duration_minutes: 60,
          total_price: 100,
          status: 'pending',
        })
        .select('id')
        .maybeSingle();
      // RLS WITH CHECK rejects (no recursion, just a policy violation).
      expect(error).not.toBeNull();
    } finally {
      await other.cleanup();
    }
  });
});
