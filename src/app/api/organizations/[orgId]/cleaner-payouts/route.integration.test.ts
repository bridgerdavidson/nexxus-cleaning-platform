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

  it('writes min_margin_bps alone (percent field untouched)', async () => {
    // Seed the percent explicitly so the untouched-assertion doesn't depend on a column default.
    await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { default_cleaner_payout_percent: 50 },
    });

    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { min_margin_bps: 1500 },
    });
    expect(status).toBe(200);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('organizations')
      .select('default_cleaner_payout_percent, min_margin_bps')
      .eq('id', org.organizationId)
      .single();
    const row = data as { default_cleaner_payout_percent: number; min_margin_bps: number };
    expect(Number(row.min_margin_bps)).toBe(1500);
    expect(Number(row.default_cleaner_payout_percent)).toBe(50);
  });

  it('writes both fields in one call', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { default_cleaner_payout_percent: 55, min_margin_bps: 2500 },
    });
    expect(status).toBe(200);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('organizations')
      .select('default_cleaner_payout_percent, min_margin_bps')
      .eq('id', org.organizationId)
      .single();
    const row = data as { default_cleaner_payout_percent: number; min_margin_bps: number };
    expect(Number(row.default_cleaner_payout_percent)).toBe(55);
    expect(Number(row.min_margin_bps)).toBe(2500);
  });

  it('rejects out-of-range and fractional min_margin_bps', async () => {
    for (const bad of [-1, 10001, 2000.5]) {
      const { status, body } = await callRoute<{ error: string }>(handlerFor(org.organizationId), {
        method: 'PATCH',
        headers: bearerHeader(org.admin.accessToken),
        body: { min_margin_bps: bad },
      });
      expect(status).toBe(400);
      expect(body.error).toBe('min_margin_bps must be an integer between 0 and 10000');
    }
  });

  it('rejects an empty body (neither field present)', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: {},
    });
    expect(status).toBe(400);
  });
});
