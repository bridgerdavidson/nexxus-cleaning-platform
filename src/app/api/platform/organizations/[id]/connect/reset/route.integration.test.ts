import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock @/lib/stripe so the reset route can call stripe.accounts.del() without
// touching the real Stripe API. We intercept the dynamic import inside the route.
const mockAccountsDel = vi.fn(async () => ({ id: 'acct_deleted', deleted: true }));
vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...actual,
    getStripe: () => ({
      accounts: { del: mockAccountsDel },
    }),
  };
});

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../../tests/helpers/supabase';

const postHandler = (id: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ id }) });

describe('POST /api/platform/organizations/:id/connect/reset', () => {
  let org: TestOrgFixture;
  let platformAdmin: PlatformAdminFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    mockAccountsDel.mockReset();
    mockAccountsDel.mockResolvedValue({ id: 'acct_deleted', deleted: true } as never);

    [org, platformAdmin] = await Promise.all([withTestOrg(), withPlatformAdmin()]);

    // Seed a Connect account on the org so reset has something to clear.
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        stripe_connect_account_id: 'acct_test_stuck',
        stripe_connect_charges_enabled: true,
        stripe_connect_payouts_enabled: true,
        stripe_connect_details_submitted: true,
        stripe_connect_requirements_due: ['individual.id_number'],
        stripe_connect_onboarded_at: new Date().toISOString(),
      })
      .eq('id', org.organizationId);
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), platformAdmin.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(postHandler(org.organizationId), {
      method: 'POST',
      body: { confirm: true },
    });
    expect(status).toBe(401);
  });

  it('returns 403 for a non-platform-admin caller', async () => {
    const { status } = await callRoute(postHandler(org.organizationId), {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken), // org admin, not platform admin
      body: { confirm: true },
    });
    expect(status).toBe(403);
  });

  it('returns 400 without confirm:true in body', async () => {
    const { status } = await callRoute(postHandler(org.organizationId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: {},
    });
    expect(status).toBe(400);
  });

  it('returns 404 for an unknown org', async () => {
    const { status } = await callRoute(postHandler('00000000-0000-0000-0000-000000000000'), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });
    expect(status).toBe(404);
  });

  it('successfully clears Connect state, calls stripe.accounts.del, writes audit', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      before_account_id: string;
      stripe_delete_status: string;
    }>(postHandler(org.organizationId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.before_account_id).toBe('acct_test_stuck');
    expect(body.stripe_delete_status).toBe('deleted');
    expect(mockAccountsDel).toHaveBeenCalledWith('acct_test_stuck');

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('organizations')
      .select(
        'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_requirements_due, stripe_connect_onboarded_at',
      )
      .eq('id', org.organizationId)
      .single();
    const r = row as Record<string, unknown>;
    expect(r.stripe_connect_account_id).toBeNull();
    expect(r.stripe_connect_charges_enabled).toBe(false);
    expect(r.stripe_connect_payouts_enabled).toBe(false);
    expect(r.stripe_connect_details_submitted).toBe(false);
    expect(r.stripe_connect_requirements_due).toEqual([]);
    expect(r.stripe_connect_onboarded_at).toBeNull();

    const { data: audit } = await db
      .from('platform_audit_log')
      .select('action, target_org_id, metadata')
      .eq('action', 'reset_tenant_connect')
      .eq('target_org_id', org.organizationId)
      .single();
    const a = audit as { action: string; target_org_id: string; metadata: Record<string, unknown> };
    expect(a.action).toBe('reset_tenant_connect');
    expect(a.metadata.before_account_id).toBe('acct_test_stuck');
    expect(a.metadata.stripe_delete_status).toBe('deleted');
  });

  it('still clears local state when stripe.accounts.del throws', async () => {
    mockAccountsDel.mockRejectedValueOnce(new Error('Account has balance'));

    const { status, body } = await callRoute<{
      success: boolean;
      stripe_delete_status: string;
      stripe_delete_error: string | null;
    }>(postHandler(org.organizationId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stripe_delete_status).toBe('error');
    expect(body.stripe_delete_error).toContain('Account has balance');

    const db = createTestSupabaseClient();
    const { data: row } = await db
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', org.organizationId)
      .single();
    expect((row as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBeNull();
  });

  it('resolves open drift events for the org', async () => {
    const db = createTestSupabaseClient();
    const { data: drift } = await db
      .from('connect_account_drift_events')
      .insert({
        organization_id: org.organizationId,
        cleaner_id: null,
        expected_account_id: 'acct_test_stuck',
        observed_account_id: 'acct_other_real',
        source: 'webhook',
        metadata: {},
      })
      .select('id')
      .single();
    const driftId = (drift as { id: string }).id;

    await callRoute(postHandler(org.organizationId), {
      method: 'POST',
      headers: bearerHeader(platformAdmin.accessToken),
      body: { confirm: true },
    });

    const { data: resolved } = await db
      .from('connect_account_drift_events')
      .select('resolved_at')
      .eq('id', driftId)
      .single();
    expect((resolved as { resolved_at: string | null }).resolved_at).not.toBeNull();
  });
});
