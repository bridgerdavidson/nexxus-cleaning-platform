import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/admin/update-cleaner', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects a request with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_percent: 50 } },
    });
    expect(status).toBe(401);
  });

  it('rejects a caller from a different org', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_percent: 50 } },
    });
    expect(status).toBe(403);
  });

  it('returns 404 for an unknown cleaner', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: '00000000-0000-0000-0000-000000000000', cleaner: { payout_percent: 50 } },
    });
    expect(status).toBe(404);
  });

  it('admin updates payout_percent and contact phone', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        cleanerId: org.cleaner.userId,
        profile: { phone: '555-0100' },
        cleaner: { payout_percent: 65 },
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data: cp } = await admin
      .from('cleaner_profiles')
      .select('payout_percent')
      .eq('id', org.cleaner.userId)
      .single();
    expect(Number(cp?.payout_percent)).toBe(65);
    const { data: up } = await admin
      .from('user_profiles')
      .select('phone')
      .eq('id', org.cleaner.userId)
      .single();
    expect(up?.phone).toBe('555-0100');
  });

  it('admin deactivates then reactivates a cleaner', async () => {
    const admin = createTestSupabaseClient();

    await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, deactivated: true },
    });
    let r = await admin
      .from('cleaner_profiles')
      .select('deactivated_at')
      .eq('id', org.cleaner.userId)
      .single();
    expect(r.data?.deactivated_at).toBeTruthy();

    await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, deactivated: false },
    });
    r = await admin
      .from('cleaner_profiles')
      .select('deactivated_at')
      .eq('id', org.cleaner.userId)
      .single();
    expect(r.data?.deactivated_at).toBeNull();
  });

  it("admin switches a cleaner to 'flat' with a rate and both persist", async () => {
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: {
        cleanerId: org.cleaner.userId,
        cleaner: { payout_model: 'flat', flat_rate_cents: 8000 },
      },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('cleaner_profiles')
      .select('payout_model, flat_rate_cents')
      .eq('id', org.cleaner.userId)
      .single();
    expect(data?.payout_model).toBe('flat');
    expect(Number(data?.flat_rate_cents)).toBe(8000);
  });

  it("admin switches a cleaner to 'request'", async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_model: 'request' } },
    });
    expect(status).toBe(200);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('cleaner_profiles')
      .select('payout_model')
      .eq('id', org.cleaner.userId)
      .single();
    expect(data?.payout_model).toBe('request');
  });

  it("normalizes the legacy 'percentage_contractor' spelling to 'percentage'", async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_model: 'percentage_contractor' } },
    });
    expect(status).toBe(200);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('cleaner_profiles')
      .select('payout_model')
      .eq('id', org.cleaner.userId)
      .single();
    expect(data?.payout_model).toBe('percentage');
  });

  it("rejects the not-yet-built 'hourly_external' with the availability error", async () => {
    const { status, body } = await callRoute<{ error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_model: 'hourly_external' } },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('That payout model is not yet available');
  });

  it('rejects unknown payout models with the value-space error', async () => {
    const { status, body } = await callRoute<{ error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_model: 'commission' } },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('payout_model must be percentage, flat, request, or hourly_external');
  });

  it('rejects negative and fractional flat_rate_cents', async () => {
    for (const bad of [-1, 1000.5]) {
      const { status, body } = await callRoute<{ error: string }>(POST, {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { cleanerId: org.cleaner.userId, cleaner: { flat_rate_cents: bad } },
      });
      expect(status).toBe(400);
      expect(body.error).toBe('flat_rate_cents must be a non-negative integer');
    }
  });
});
