import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the tenant Connect lib (its real impl calls getStripe(), which the global
// integration setup stubs to throw). We assert the route mirrors the returned status
// into `organizations`.
vi.mock('@/lib/stripe/connect/tenant', () => ({
  getTenantConnectStatus: vi.fn(async () => ({
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    requirementsDue: [],
  })),
}));

import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';

describe('POST /api/stripe/tenant/connect/refresh-status', () => {
  let org: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_TENANT_CONNECT_ENABLED;
    process.env.STRIPE_TENANT_CONNECT_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_TENANT_CONNECT_ENABLED = originalFlag;
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('returns 400 when the org has no connected account yet', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(400);
  });

  it('mirrors Stripe account status into the organization row', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ stripe_connect_account_id: 'acct_test_refresh' })
      .eq('id', org.organizationId);

    const { status, body } = await callRoute<{
      success: boolean;
      status: { chargesEnabled: boolean; detailsSubmitted: boolean };
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status.chargesEnabled).toBe(true);

    const { data: orgRow } = await db
      .from('organizations')
      .select(
        'stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_onboarded_at',
      )
      .eq('id', org.organizationId)
      .single();

    const row = orgRow as {
      stripe_connect_charges_enabled: boolean;
      stripe_connect_payouts_enabled: boolean;
      stripe_connect_details_submitted: boolean;
      stripe_connect_onboarded_at: string | null;
    };
    expect(row.stripe_connect_charges_enabled).toBe(true);
    expect(row.stripe_connect_payouts_enabled).toBe(true);
    expect(row.stripe_connect_details_submitted).toBe(true);
    expect(row.stripe_connect_onboarded_at).not.toBeNull();
  });
});
