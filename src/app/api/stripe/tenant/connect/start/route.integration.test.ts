import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The global integration setup mocks @/lib/stripe so getStripe() throws. Our tenant
// helpers live in a separate module and call getStripe() internally, so we mock the
// whole tenant module here to keep real Stripe out of the test while still exercising
// the route's auth, org-scoping, and DB-persistence behavior.
vi.mock('@/lib/stripe/connect/tenant', () => ({
  createTenantConnectAccount: vi.fn(async (orgId: string) => ({ id: `acct_test_${orgId.slice(0, 8)}` })),
  createTenantAccountSession: vi.fn(async (acctId: string) => ({ client_secret: `accs_secret_${acctId}` })),
  getTenantConnectStatus: vi.fn(async () => ({
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsDue: [],
  })),
}));

import { POST } from './route';
import { createTenantConnectAccount } from '@/lib/stripe/connect/tenant';
import { callRoute, bearerHeader } from '../../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';

describe('POST /api/stripe/tenant/connect/start', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_TENANT_CONNECT_ENABLED;
    process.env.STRIPE_TENANT_CONNECT_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    process.env.STRIPE_TENANT_CONNECT_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('returns 404 when STRIPE_TENANT_CONNECT_ENABLED is false', async () => {
    process.env.STRIPE_TENANT_CONNECT_ENABLED = 'false';
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(404);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('rejects a cross-org caller (org2 admin acting on org1)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('creates a connected account and persists it, returning a client secret', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      account_id: string;
      client_secret: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.account_id).toMatch(/^acct_test_/);
    expect(body.client_secret).toMatch(/^accs_secret_/);

    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', org.organizationId)
      .single();
    expect((orgRow as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBe(
      body.account_id,
    );
  });

  it('is idempotent: a second call reuses the existing account (no new account created)', async () => {
    const headers = bearerHeader(org.admin.accessToken);
    const reqBody = { organization_id: org.organizationId };

    const first = await callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody });
    const second = await callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody });

    expect(first.body.account_id).toBe(second.body.account_id);
    // account created exactly once; the second call only made a fresh Account Session
    expect(vi.mocked(createTenantConnectAccount)).toHaveBeenCalledTimes(1);
  });

  it('passes a per-org idempotency key to stripe.accounts.create', async () => {
    await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(vi.mocked(createTenantConnectAccount)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(createTenantConnectAccount).mock.calls[0];
    // signature: (organizationId, email, orgName, options)
    // Key shape: tenant-connect-<org-uuid>-<env>-<attempt_number>
    expect(call[3]).toEqual(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          new RegExp(`^tenant-connect-${org.organizationId}-[\\w-]+-\\d+$`),
        ),
      }),
    );
  });

  it('uses an incremented idempotency key after a reset bumps the attempt counter', async () => {
    const db = createTestSupabaseClient();
    // Simulate a previous reset by pre-bumping the counter.
    await db
      .from('organizations')
      .update({ stripe_connect_attempt_number: 3 })
      .eq('id', org.organizationId);

    await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    const call = vi.mocked(createTenantConnectAccount).mock.calls[0];
    expect((call[3] as { idempotencyKey: string }).idempotencyKey).toMatch(/-3$/);
  });

  it('concurrent /start calls produce exactly one Stripe account (race-safe)', async () => {
    // Widen the race window: any second request that races past the DB read but
    // before the first writes back must NOT trigger a second accounts.create.
    vi.mocked(createTenantConnectAccount).mockImplementationOnce(async (orgId: string) => {
      await new Promise((r) => setTimeout(r, 200));
      return { id: `acct_test_${orgId.slice(0, 8)}` } as never;
    });

    const headers = bearerHeader(org.admin.accessToken);
    const reqBody = { organization_id: org.organizationId };

    const [a, b] = await Promise.all([
      callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody }),
      callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody }),
    ]);

    expect(vi.mocked(createTenantConnectAccount)).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.account_id).toBe(b.body.account_id);

    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', org.organizationId)
      .single();
    expect((orgRow as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBe(
      a.body.account_id,
    );
  });

  it('releases the slot back to NULL when stripe.accounts.create throws', async () => {
    vi.mocked(createTenantConnectAccount).mockImplementationOnce(async () => {
      throw new Error('Stripe is down');
    });

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(500);

    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', org.organizationId)
      .single();
    // Slot returned to NULL — next /start call can claim cleanly.
    expect((orgRow as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBeNull();
  });
});
