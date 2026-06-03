import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/**
 * RLS for ORG-OWNED (self-pay) properties — migration 077 `properties_select`.
 *
 * An org-owned property has owner_id = NULL. The 077 policy adds a branch so org owner/admin/manager
 * can see it (their homeowner-ownership branch can't, since there's no owner). The assigned cleaner
 * still sees it via the appointments branch. An unrelated homeowner must NOT.
 *
 * This is a pure RLS test (no route, no Stripe). Each role acts through an anon client carrying its
 * own JWT (the proven pattern from the impersonation RLS test), so the `auth.uid()` checks in the
 * policy evaluate against the real signed-in user.
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

describe('RLS: org-owned (self-pay) property visibility', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let orgOwnedPropertyId: string;
  let managerToken: string;

  beforeEach(async () => {
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    const db = createTestSupabaseClient();

    // An org-owned property (owner_id = null) with a self-pay appointment assigned to the cleaner.
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      orgOwnedProperty: true,
      selfPay: true,
    });
    orgOwnedPropertyId = appt.propertyId;

    // Promote org's homeowner-user to an org MANAGER but keep UserRole 'homeowner' so the
    // `user_profiles.role IN (admin,manager)` god-mode branch does NOT apply — this isolates the
    // self-pay `om_self` manager branch as the sole reason the manager can see the property.
    await db
      .from('organization_members')
      .update({ role: 'manager' })
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId);
    managerToken = org.homeowner.accessToken;
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('org admin can read the org-owned property', async () => {
    const { data } = await anonAs(org.admin.accessToken)
      .from('properties')
      .select('id, owner_id')
      .eq('id', orgOwnedPropertyId);
    expect((data ?? []).length).toBe(1);
    expect((data![0] as { owner_id: string | null }).owner_id).toBeNull();
  });

  it('org manager (via the self-pay om_self branch, not god-mode) can read the org-owned property', async () => {
    const { data } = await anonAs(managerToken)
      .from('properties')
      .select('id')
      .eq('id', orgOwnedPropertyId);
    expect((data ?? []).length).toBe(1);
  });

  it('the assigned cleaner can read the org-owned property (via the appointment branch)', async () => {
    const { data } = await anonAs(org.cleaner.accessToken)
      .from('properties')
      .select('id')
      .eq('id', orgOwnedPropertyId);
    expect((data ?? []).length).toBe(1);
  });

  it('an unrelated homeowner (different org) CANNOT read the org-owned property', async () => {
    const { data } = await anonAs(org2.homeowner.accessToken)
      .from('properties')
      .select('id')
      .eq('id', orgOwnedPropertyId);
    expect((data ?? []).length).toBe(0);
  });

  it('a cleaner from a different org (no assignment) CANNOT read it', async () => {
    const { data } = await anonAs(org2.cleaner.accessToken)
      .from('properties')
      .select('id')
      .eq('id', orgOwnedPropertyId);
    expect((data ?? []).length).toBe(0);
  });

  it('sanity: the service-role client always sees it (RLS bypassed)', async () => {
    const db = createTestSupabaseClient();
    const { data } = await db.from('properties').select('id').eq('id', orgOwnedPropertyId);
    expect((data ?? []).length).toBe(1);
  });
});
