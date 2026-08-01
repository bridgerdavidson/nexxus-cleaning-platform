import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';

/**
 * cleaner_scorecard returns payout_configured_at (the cleaner_pay_configured
 * migration): NULL = no pay decision was ever made, which the roster renders as
 * the "Pay not set" badge. This is the only surface the operator UI reads it
 * from, so the column must round-trip through the RPC, not just sit on the table.
 */

describe('cleaner_scorecard — payout_configured_at', () => {
  let org: TestOrgFixture;
  const admin = createTestSupabaseClient();

  beforeAll(async () => {
    org = await withTestOrg({ cleanerPayConfigured: false });
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it('surfaces NULL for an unconfigured cleaner, then the timestamp once pay is set', async () => {
    const staff = createUserClient(org.admin.accessToken);
    const { data: before, error: beforeErr } = await staff.rpc('cleaner_scorecard', {
      p_org_id: org.organizationId,
    });
    expect(beforeErr).toBeNull();
    const rowBefore = (before as Array<{ id: string; payout_configured_at: string | null }>).find(
      (r) => r.id === org.cleaner.userId,
    );
    expect(rowBefore).toBeDefined();
    expect(rowBefore!.payout_configured_at).toBeNull();

    await admin
      .from('cleaner_profiles')
      .update({ payout_configured_at: new Date().toISOString() })
      .eq('id', org.cleaner.userId);

    const { data: after } = await staff.rpc('cleaner_scorecard', {
      p_org_id: org.organizationId,
    });
    const rowAfter = (after as Array<{ id: string; payout_configured_at: string | null }>).find(
      (r) => r.id === org.cleaner.userId,
    );
    expect(rowAfter!.payout_configured_at).toBeTruthy();
  });

  it('the 093 authorization is preserved: a homeowner member gets no rows', async () => {
    const homeowner = createUserClient(org.homeowner.accessToken);
    const { data, error } = await homeowner.rpc('cleaner_scorecard', {
      p_org_id: org.organizationId,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
