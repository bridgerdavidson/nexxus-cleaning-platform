import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (orgId: string) => (req: NextRequest) =>
  PATCH(req, { params: Promise.resolve({ orgId }) });

describe('PATCH /api/organizations/:orgId/cleaner-experience', () => {
  let org: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      body: { cleaner_pay_display: 'payout_only' },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { cleaner_pay_display: 'payout_only' },
    });
    expect(status).toBe(403);
  });

  it('admin updates cleaner_pay_display and require_job_photos, org row reflects both', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleaner_pay_display: 'payout_only', require_job_photos: false },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('organizations')
      .select('cleaner_pay_display, require_job_photos')
      .eq('id', org.organizationId)
      .single();
    expect(row?.cleaner_pay_display).toBe('payout_only');
    expect(row?.require_job_photos).toBe(false);
  });

  it('returns 400 on an invalid cleaner_pay_display value', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleaner_pay_display: 'bogus' },
    });
    expect(status).toBe(400);
  });

  it('returns 400 when body has no valid fields', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: {},
    });
    expect(status).toBe(400);
  });
});
