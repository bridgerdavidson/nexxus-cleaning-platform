import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { requireManagerPermission } from './requireManagerPermission';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';
import { withTestOrg, addManagerToOrg } from '../../../tests/helpers/fixtures';

const admin = createTestSupabaseClient();
const req = (token?: string) =>
  new NextRequest('http://t.local/x', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

let org: Awaited<ReturnType<typeof withTestOrg>> | null = null;
let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

afterEach(async () => {
  if (mgr) { await mgr.cleanup(); mgr = null; }
  if (org) { await org.cleanup(); org = null; }
});

describe('requireManagerPermission', () => {
  it('401 without a token', async () => {
    org = await withTestOrg();
    const r = await requireManagerPermission(req(), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it('admin bypasses the flag (200)', async () => {
    org = await withTestOrg();
    const r = await requireManagerPermission(req(org.admin.accessToken), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(true);
  });

  it('manager WITHOUT the flag is 403', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
    const r = await requireManagerPermission(req(mgr.accessToken), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it('manager WITH the flag passes (200)', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    const r = await requireManagerPermission(req(mgr.accessToken), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(true);
  });

  it('respects allowedRoles: a homeowner passes when whitelisted, without needing the flag', async () => {
    org = await withTestOrg();
    const r = await requireManagerPermission(
      req(org.homeowner.accessToken), org.organizationId, admin, 'can_edit_bookings',
      { allowedRoles: ['owner', 'admin', 'manager', 'homeowner'] },
    );
    expect(r.ok).toBe(true);
  });
});
