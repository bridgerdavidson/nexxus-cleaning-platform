import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/**
 * Security audit C2/F-CORE-1: this route was fully unauthenticated and accepted a
 * client-supplied organization_id/homeowner_id/amount, writing invoices via the
 * service-role client. It now requires org staff (requireOrgAuth) and verifies the
 * homeowner belongs to the caller's org.
 */
describe('POST /api/invoices/create (auth)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header (was unauthenticated)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId, amount: 999999 },
    });
    expect(status).toBe(401);

    // Nothing was written.
    const db = createTestSupabaseClient();
    const { count } = await db
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', org.organizationId);
    expect(count ?? 0).toBe(0);
  });

  it('rejects a cleaner (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId, amount: 100 },
    });
    expect(status).toBe(403);
  });

  it("rejects an admin from another org (403 — not a member of the body's org)", async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId, amount: 100 },
    });
    expect(status).toBe(403);
  });

  it('rejects a homeowner not belonging to the org (404)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org2.homeowner.userId, amount: 100 },
    });
    expect(status).toBe(404);
  });

  it('succeeds for an org admin and writes the invoice', async () => {
    const { status, body } = await callRoute<{ success: boolean; invoice: { id: string; amount: number } }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId, homeowner_id: org.homeowner.userId, amount: 150 },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('invoices')
      .select('id, organization_id, homeowner_id')
      .eq('id', body.invoice.id)
      .single();
    expect(data?.organization_id).toBe(org.organizationId);
    expect(data?.homeowner_id).toBe(org.homeowner.userId);
  });
});
