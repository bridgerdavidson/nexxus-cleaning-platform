import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (orgId: string) => (req: NextRequest) =>
  PATCH(req, { params: Promise.resolve({ orgId }) });

describe('PATCH /api/organizations/:orgId/cleaner-payouts', () => {
  let org: TestOrgFixture;
  beforeEach(async () => { org = await withTestOrg(); });
  afterEach(async () => { await org.cleanup(); });

  it('stamps payout_configured_at on save', async () => {
    const { status } = await callRoute<{ success: boolean }>(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { default_cleaner_payout_percent: 60 },
    });
    expect(status).toBe(200);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('organizations')
      .select('default_cleaner_payout_percent, payout_configured_at')
      .eq('id', org.organizationId)
      .single();
    const row = data as { default_cleaner_payout_percent: number; payout_configured_at: string | null };
    expect(Number(row.default_cleaner_payout_percent)).toBe(60);
    expect(row.payout_configured_at).not.toBeNull();
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { default_cleaner_payout_percent: 60 },
    });
    expect(status).toBe(403);
  });
});
