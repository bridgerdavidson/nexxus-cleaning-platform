import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const HOURS = {
  mon: { open: '08:00', close: '17:00', closed: false },
  tue: { open: '08:00', close: '17:00', closed: false },
  wed: { open: '08:00', close: '17:00', closed: false },
  thu: { open: '08:00', close: '17:00', closed: false },
  fri: { open: '08:00', close: '17:00', closed: false },
  sat: { open: '09:00', close: '14:00', closed: true },
  sun: { open: '09:00', close: '14:00', closed: true },
};

const handlerFor = (orgId: string) => (req: NextRequest) =>
  PATCH(req, { params: Promise.resolve({ orgId }) });

describe('PATCH /api/organizations/:orgId/business-hours', () => {
  let org: TestOrgFixture;
  beforeEach(async () => { org = await withTestOrg(); });
  afterEach(async () => { await org.cleanup(); });

  it('stamps hours_policy_configured_at on save', async () => {
    const { status } = await callRoute<{ success: boolean }>(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { timezone: 'America/New_York', business_hours: HOURS },
    });
    expect(status).toBe(200);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('organizations')
      .select('hours_policy_configured_at')
      .eq('id', org.organizationId)
      .single();
    expect((data as { hours_policy_configured_at: string | null }).hours_policy_configured_at).not.toBeNull();
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { timezone: 'America/New_York', business_hours: HOURS },
    });
    expect(status).toBe(403);
  });
});
