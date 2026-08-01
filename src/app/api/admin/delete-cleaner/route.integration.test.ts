import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createAuthUser,
  createTestAppointment,
  createTestPayRequest,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/** Seeds an OrgRole 'manager' member, optionally with can_manage_cleaners. */
async function addManager(organizationId: string, canManageCleaners: boolean) {
  const db = createTestSupabaseClient();
  const email = `manager-${randomUUID().slice(0, 8)}@test.local`;
  const mgr = await createAuthUser(email, 'manager', 'Manager');
  const { error: profileErr } = await db.from('user_profiles').upsert(
    { id: mgr.id, email, first_name: 'Manny', last_name: 'Manager', role: 'manager' },
    { onConflict: 'id' },
  );
  if (profileErr) throw new Error(`seed manager profile failed: ${profileErr.message}`);
  const { error: memErr } = await db
    .from('organization_members')
    .insert({ user_id: mgr.id, organization_id: organizationId, role: 'manager' });
  if (memErr) throw new Error(`seed manager member failed: ${memErr.message}`);
  const { error: permErr } = await db.from('manager_permissions').insert({
    manager_id: mgr.id,
    organization_id: organizationId,
    can_manage_cleaners: canManageCleaners,
  });
  if (permErr) throw new Error(`seed manager perms failed: ${permErr.message}`);
  return {
    ...mgr,
    async cleanup() {
      await db.auth.admin.deleteUser(mgr.id);
    },
  };
}

/**
 * Security regression: delete-cleaner had NO caller auth — anyone who could
 * reach it could delete any cleaner. It now derives the cleaner's org from
 * cleaner_profiles and requires the caller to be an owner/admin of THAT org.
 */
describe('DELETE /api/admin/delete-cleaner (authorization)', () => {
  let org: TestOrgFixture | null = null;
  let otherOrg: TestOrgFixture | null = null;
  let manager: Awaited<ReturnType<typeof addManager>> | null = null;

  afterEach(async () => {
    await manager?.cleanup();
    await Promise.all([org?.cleanup(), otherOrg?.cleanup()]);
    org = null;
    otherOrg = null;
    manager = null;
  });

  const url = (cleanerId: string) =>
    `http://test.local/api/admin/delete-cleaner?id=${encodeURIComponent(cleanerId)}`;

  it('401 without a token', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(DELETE, { method: 'DELETE', url: url(org.cleaner.userId) });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(org.cleaner.accessToken),
    });
    expect(status).toBe(403);
  });

  it("rejects an admin from a different org (403) and leaves the cleaner intact", async () => {
    [org, otherOrg] = await Promise.all([withTestOrg(), withTestOrg()]);
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(otherOrg.admin.accessToken),
    });
    expect(status).toBe(403);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('cleaner_profiles')
      .select('id')
      .eq('id', org.cleaner.userId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it('lets the org admin delete a cleaner (200)', async () => {
    org = await withTestOrg();
    const { status, body } = await callRoute<{ success: boolean }>(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('cleaner_profiles')
      .select('id')
      .eq('id', org.cleaner.userId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('blocks deletion while a pay-request thread is open, allows it once approved', async () => {
    org = await withTestOrg({ cleanerPayoutModel: 'request', minMarginBps: 2000 });
    const db = createTestSupabaseClient();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
      totalPrice: 100,
    });
    const pr = await createTestPayRequest({
      organizationId: org.organizationId,
      appointmentId: appt.id,
      cleanerId: org.cleaner.userId,
      status: 'pending_org',
      jobPriceCents: 10000,
      offers: [{ actor: 'cleaner', actorUserId: org.cleaner.userId, amountCents: 9000, minMarginBpsSnapshot: 2000 }],
    });

    const blocked = await callRoute<{ error: string }>(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('Cannot delete a cleaner with an open pay request. Resolve it first.');

    await db
      .from('pay_requests')
      .update({
        status: 'approved',
        approved_amount_cents: 9000,
        approved_via: 'org',
        approved_by: org.admin.userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', pr.id);

    // Approved but UNSETTLED still blocks (review finding 2: deletion would
    // cascade the payout basis away while money is carved/held).
    const unsettled = await callRoute<{ error: string }>(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(unsettled.status).toBe(400);
    expect(unsettled.body.error).toBe(
      'Cannot delete a cleaner with an unsettled pay request. Wait for the payout to finish first.',
    );

    await db.from('payouts').insert({
      organization_id: org.organizationId,
      cleaner_id: org.cleaner.userId,
      appointment_id: appt.id,
      amount: 90,
      status: 'paid',
      payout_model_snapshot: 'request',
      pay_request_id: pr.id,
      paid_at: new Date().toISOString(),
    });

    const allowed = await callRoute<{ success: boolean }>(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.success).toBe(true);
  });

  it('404 for a non-existent cleaner', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url('00000000-0000-0000-0000-000000000000'),
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(404);
  });

  it('lets a manager with can_manage_cleaners delete a cleaner (200)', async () => {
    org = await withTestOrg();
    manager = await addManager(org.organizationId, true);

    const { status, body } = await callRoute<{ success: boolean }>(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(manager.accessToken),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('rejects a manager without can_manage_cleaners (403)', async () => {
    org = await withTestOrg();
    manager = await addManager(org.organizationId, false);

    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url(org.cleaner.userId),
      headers: bearerHeader(manager.accessToken),
    });
    expect(status).toBe(403);

    // The cleaner must still exist.
    const db = createTestSupabaseClient();
    const { data } = await db
      .from('cleaner_profiles')
      .select('id')
      .eq('id', org.cleaner.userId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });
});
