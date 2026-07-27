import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addOwnerToOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

/**
 * Pins the payout-model value space post-migration-118: the route accepts
 * BOTH spellings of the percentage model (stale clients may still send the
 * legacy one) and writes the unified 'percentage'.
 */
describe('PATCH /api/organizations/[orgId]/profile payout model', () => {
  let org: TestOrgFixture;
  let owner: Awaited<ReturnType<typeof addOwnerToOrg>>;

  beforeEach(async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
  });

  afterEach(async () => {
    await org.cleanup();
  });

  function patch(body: Record<string, unknown>, token: string) {
    return callRoute(
      (req: NextRequest) => PATCH(req, { params: Promise.resolve({ orgId: org.organizationId }) }),
      {
        method: 'PATCH',
        url: `http://test/api/organizations/${org.organizationId}/profile`,
        headers: bearerHeader(token),
        body,
      },
    );
  }

  it("accepts and writes 'percentage'", async () => {
    const res = await patch({ default_payout_model: 'percentage' }, owner.accessToken);
    expect(res.status).toBe(200);
    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('organizations')
      .select('default_payout_model')
      .eq('id', org.organizationId)
      .single();
    expect((data as { default_payout_model: string }).default_payout_model).toBe('percentage');
  });

  it("accepts the legacy 'percentage_contractor' spelling from stale clients and writes 'percentage'", async () => {
    const res = await patch({ default_payout_model: 'percentage_contractor' }, owner.accessToken);
    expect(res.status).toBe(200);
    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('organizations')
      .select('default_payout_model')
      .eq('id', org.organizationId)
      .single();
    expect((data as { default_payout_model: string }).default_payout_model).toBe('percentage');
  });

  it('rejects not-yet-selectable models with the availability error', async () => {
    for (const model of ['flat', 'request', 'hourly_external']) {
      const res = await patch({ default_payout_model: model }, owner.accessToken);
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('That payout model is not yet available');
    }
  });

  it('rejects unknown models with the value-space error', async () => {
    const res = await patch({ default_payout_model: 'commission' }, owner.accessToken);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe(
      'default_payout_model must be percentage, flat, request, or hourly_external',
    );
  });

  it('is owner-only (admin token is rejected)', async () => {
    const res = await patch({ default_payout_model: 'percentage' }, org.admin.accessToken);
    expect(res.status).toBe(403);
  });
});
