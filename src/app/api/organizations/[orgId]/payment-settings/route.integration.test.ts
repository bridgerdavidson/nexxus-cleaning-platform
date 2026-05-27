import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (orgId: string) => (req: NextRequest) =>
  PATCH(req, { params: Promise.resolve({ orgId }) });

describe('PATCH /api/organizations/:orgId/payment-settings', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      body: { cancellation_fee_type: 'flat' },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { cancellation_fee_type: 'flat' },
    });
    expect(status).toBe(403);
  });

  it('admin updates the cancellation policy and the org row reflects it', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { cancellation_window_hours: 48, cancellation_fee_type: 'flat', cancellation_fee_value: 25 },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('organizations')
      .select('cancellation_window_hours, cancellation_fee_type, cancellation_fee_value')
      .eq('id', org.organizationId)
      .single();
    const row = data as {
      cancellation_window_hours: number;
      cancellation_fee_type: string;
      cancellation_fee_value: number;
    };
    expect(row.cancellation_window_hours).toBe(48);
    expect(row.cancellation_fee_type).toBe('flat');
    expect(Number(row.cancellation_fee_value)).toBe(25);
  });

  it('returns 400 on an invalid fee type', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { cancellation_fee_type: 'bogus' },
    });
    expect(status).toBe(400);
  });

  it('returns 400 when a percent fee exceeds 100', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { cancellation_fee_type: 'percent', cancellation_fee_value: 150 },
    });
    expect(status).toBe(400);
  });

  it('rejects an admin acting on an org they do not belong to', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org2.admin.accessToken),
      body: { cancellation_fee_type: 'flat' },
    });
    expect([403, 404]).toContain(status);
  });
});
