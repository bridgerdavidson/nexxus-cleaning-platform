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

  it("accepts and writes 'flat' and 'request' (selectable since the org settings UI shipped)", async () => {
    const admin = createTestSupabaseClient();
    for (const model of ['flat', 'request']) {
      const res = await patch({ default_payout_model: model }, owner.accessToken);
      expect(res.status).toBe(200);
      const { data } = await admin
        .from('organizations')
        .select('default_payout_model')
        .eq('id', org.organizationId)
        .single();
      expect((data as { default_payout_model: string }).default_payout_model).toBe(model);
    }
  });

  it("rejects the not-yet-built 'hourly_external' with the availability error", async () => {
    const res = await patch({ default_payout_model: 'hourly_external' }, owner.accessToken);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('That payout model is not yet available');
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

  describe('billing_email', () => {
    it('writes a lowercased billing_email and clears it with null', async () => {
      const admin = createTestSupabaseClient();

      const res = await patch({ billing_email: 'Billing@Example.COM' }, owner.accessToken);
      expect(res.status).toBe(200);
      const { data: after } = await admin
        .from('organizations')
        .select('billing_email')
        .eq('id', org.organizationId)
        .single();
      expect((after as { billing_email: string | null }).billing_email).toBe('billing@example.com');

      const clear = await patch({ billing_email: null }, owner.accessToken);
      expect(clear.status).toBe(200);
      const { data: cleared } = await admin
        .from('organizations')
        .select('billing_email')
        .eq('id', org.organizationId)
        .single();
      expect((cleared as { billing_email: string | null }).billing_email).toBeNull();
    });

    it('rejects a malformed billing_email', async () => {
      const res = await patch({ billing_email: 'not-an-email' }, owner.accessToken);
      expect(res.status).toBe(400);
    });
  });

  describe('retired fields', () => {
    // The company name moved to the branding route; logo_url was removed with
    // the legacy paste-a-URL logo field. Either alone must no longer count as
    // a valid field, and neither may reach the database.
    it('no longer accepts name (moved to branding route)', async () => {
      const res = await patch({ name: 'Sneaky Rename LLC' }, owner.accessToken);
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('No valid fields to update');

      const admin = createTestSupabaseClient();
      const { data } = await admin
        .from('organizations')
        .select('name')
        .eq('id', org.organizationId)
        .single();
      expect((data as { name: string }).name).not.toBe('Sneaky Rename LLC');
    });

    it('no longer accepts logo_url', async () => {
      const res = await patch({ logo_url: 'https://example.com/logo.png' }, owner.accessToken);
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('No valid fields to update');
    });

    it('ignores retired fields riding alongside a valid one', async () => {
      const res = await patch(
        { default_payout_model: 'flat', name: 'Sneaky Rename LLC', logo_url: 'https://example.com/x.png' },
        owner.accessToken,
      );
      expect(res.status).toBe(200);
      const admin = createTestSupabaseClient();
      const { data } = await admin
        .from('organizations')
        .select('name, default_payout_model')
        .eq('id', org.organizationId)
        .single();
      const row = data as { name: string; default_payout_model: string };
      expect(row.default_payout_model).toBe('flat');
      expect(row.name).not.toBe('Sneaky Rename LLC');
    });
  });
});
