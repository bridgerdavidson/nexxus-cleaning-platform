import { describe, it, expect, afterEach } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, addManagerToOrg, createTestAppointment } from '../../../../tests/helpers/fixtures';

// Migration 106 splits the manager branch out of the live appointments write
// policies (074, patched by 078/083) and gates it on can_edit_bookings instead
// of letting any org manager write unconditionally via
// is_admin_or_manager_in_org() / user_shares_org_with_homeowner(). The
// redesigned dashboard writes appointment status/cancel directly to
// Supabase (bypassing the guarded API routes), so this flag must be enforced
// in RLS, not just app code. These tests prove:
//   - a manager WITHOUT can_edit_bookings is blocked (0 rows, no error) on
//     UPDATE and DELETE — this is the gap being closed.
//   - a manager WITH can_edit_bookings still works.
//   - org admin, the assigned cleaner (cleaner_id self branch), and the
//     homeowner (homeowner_id self branch) are unaffected regressions.

const admin = createTestSupabaseClient();
let org: Awaited<ReturnType<typeof withTestOrg>> | null = null;
let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

afterEach(async () => {
  if (mgr) {
    await mgr.cleanup();
    mgr = null;
  }
  if (org) {
    await org.cleanup();
    org = null;
  }
});

async function seedAppointment(orgId: string, cleanerId: string, homeownerId: string) {
  const { id } = await createTestAppointment({
    organizationId: orgId,
    cleanerId,
    homeownerId,
  });
  return id;
}

describe('manager RLS: appointments UPDATE requires can_edit_bookings', () => {
  it('denies a manager without the flag (0 rows, no error)', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', apptId)
      .select('id');
    expect(error).toBeNull(); // RLS silently filters rows out; a real error would masquerade as "blocked"
    expect(data ?? []).toHaveLength(0); // RLS blocked the row
  });

  it('allows a manager with the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', apptId)
      .select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });
});

describe('regression: appointments UPDATE still works for admin, assigned cleaner, and homeowner', () => {
  it('org admin updates an appointment under RLS', async () => {
    org = await withTestOrg();
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(org.admin.accessToken);
    const { data, error } = await db
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', apptId)
      .select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it('the assigned cleaner can no longer update directly (sealed; route write path)', async () => {
    org = await withTestOrg();
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(org.cleaner.accessToken);
    // The price-seal migration sealed the cleaner's SELECT arm, and an UPDATE's WHERE
    // clause needs SELECT rights on the row, so this is a silent zero-row
    // no-op. Cleaner status writes now go through
    // POST /api/cleaner/appointments/[id]/status (see its test file).
    const { error } = await db
      .from('appointments')
      .update({ status: 'in_progress' })
      .eq('id', apptId);
    expect(error).toBeNull();
    const { data: after } = await admin.from('appointments').select('status').eq('id', apptId).single();
    expect((after as { status: string } | null)?.status).toBe('pending');
  });

  it('the homeowner updates their own appointment under RLS (homeowner_id self branch)', async () => {
    org = await withTestOrg();
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(org.homeowner.accessToken);
    const { data, error } = await db
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', apptId)
      .select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });
});

describe('manager RLS: appointments DELETE requires can_edit_bookings', () => {
  it('denies a manager without the flag (0 rows, no error)', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db.from('appointments').delete().eq('id', apptId).select('id');
    expect(error).toBeNull(); // RLS silently filters rows out; a real error would masquerade as "blocked"
    expect(data ?? []).toHaveLength(0); // RLS blocked the row

    // Confirm under admin (bypasses RLS) that the row is genuinely still there,
    // not deleted-but-unreturned.
    const { data: stillThere } = await admin.from('appointments').select('id').eq('id', apptId).single();
    expect(stillThere?.id).toBe(apptId);
  });

  it('allows a manager with the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db.from('appointments').delete().eq('id', apptId).select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it('regression: org admin can still delete an appointment under RLS', async () => {
    org = await withTestOrg();
    const apptId = await seedAppointment(org.organizationId, org.cleaner.userId, org.homeowner.userId);
    const db = createUserClient(org.admin.accessToken);
    const { data, error } = await db.from('appointments').delete().eq('id', apptId).select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });
});

describe('manager RLS: appointments INSERT requires can_edit_bookings', () => {
  it('denies a manager without the flag (0 rows, no error)', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });

    // Seed a property + service_type via the admin (RLS-exempt) client, then
    // attempt the appointments INSERT itself under RLS as the manager. This
    // isolates the assertion to the appointments_insert policy's manager
    // branch rather than upstream property/service_type write policies.
    const { data: prop, error: propErr } = await admin
      .from('properties')
      .insert({
        organization_id: org.organizationId,
        owner_id: org.homeowner.userId,
        name: 'Test Property',
        address: '1 Test Lane',
        city: 'Testville',
        state: 'TS',
        zip_code: '00000',
      })
      .select('id')
      .single();
    expect(propErr).toBeNull();

    const { data: svc, error: svcErr } = await admin
      .from('service_types')
      .insert({
        organization_id: org.organizationId,
        name: 'Test Service',
        base_price: 100,
        duration_minutes: 60,
        service_type: 'regular',
      })
      .select('id')
      .single();
    expect(svcErr).toBeNull();

    const db = createUserClient(mgr.accessToken);
    const { data, error } = await db
      .from('appointments')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: org.cleaner.userId,
        homeowner_id: org.homeowner.userId,
        property_id: prop!.id,
        service_type_id: svc!.id,
        scheduled_date: '2026-06-01',
        scheduled_time: '10:00',
        duration_minutes: 60,
        total_price: 100,
        status: 'pending',
      })
      .select('id');
    // Unlike UPDATE/DELETE (USING clause, silently filters), INSERT is gated by a
    // WITH CHECK clause: a violating row is a hard Postgres error ("new row
    // violates row-level security policy"), not a silently-empty result.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
