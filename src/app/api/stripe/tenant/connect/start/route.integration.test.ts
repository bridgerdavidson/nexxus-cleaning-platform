import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The global integration setup mocks @/lib/stripe so getStripe() throws. Our tenant
// helpers live in a separate module and call getStripe() internally, so we mock the
// whole tenant module here to keep real Stripe out of the test while still exercising
// the route's auth, role-scoping, org-scoping, and DB-persistence behavior.
//
// createTenantAccountSession encodes the scope into the secret so tests can assert
// owner vs viewer sessions: `accs_<scope>_<accountId>`.
vi.mock('@/lib/stripe/connect/tenant', () => ({
  createTenantConnectAccount: vi.fn(async (orgId: string) => ({ id: `acct_test_${orgId.slice(0, 8)}` })),
  createTenantAccountSession: vi.fn(async (acctId: string, scope: string = 'owner') => ({
    client_secret: `accs_${scope}_${acctId}`,
  })),
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
import {
  withTestOrg,
  addOwnerToOrg,
  addManagerToOrg,
  type TestOrgFixture,
  type OwnerMemberHandle,
} from '../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';

describe('POST /api/stripe/tenant/connect/start', () => {
  let org: TestOrgFixture;
  let owner: OwnerMemberHandle;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_TENANT_CONNECT_ENABLED;
    process.env.STRIPE_TENANT_CONNECT_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
  });

  afterEach(async () => {
    process.env.STRIPE_TENANT_CONNECT_ENABLED = originalFlag;
    await Promise.all([owner.cleanup(), org.cleanup()]);
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
      headers: bearerHeader(owner.accessToken),
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

  it('rejects a cross-org caller (a different org admin acting on this org)', async () => {
    const org2 = await withTestOrg();
    try {
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(org2.admin.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(403);
    } finally {
      await org2.cleanup();
    }
  });

  // ---- Owner: full setup (creates the account + onboarding session) ----

  it('owner creates a connected account and persists it, returning an owner session', async () => {
    const { status, body } = await callRoute<{
      success: boolean;
      account_id: string;
      client_secret: string;
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.account_id).toMatch(/^acct_test_/);
    expect(body.client_secret).toMatch(/^accs_owner_/);

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

  it('is idempotent for the owner: a second call reuses the account (no new account created)', async () => {
    const headers = bearerHeader(owner.accessToken);
    const reqBody = { organization_id: org.organizationId };

    const first = await callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody });
    const second = await callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody });

    expect(first.body.account_id).toBe(second.body.account_id);
    expect(vi.mocked(createTenantConnectAccount)).toHaveBeenCalledTimes(1);
  });

  it('passes a per-org idempotency key to stripe.accounts.create', async () => {
    await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(vi.mocked(createTenantConnectAccount)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(createTenantConnectAccount).mock.calls[0];
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
    await db
      .from('organizations')
      .update({ stripe_connect_attempt_number: 3 })
      .eq('id', org.organizationId);

    await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { organization_id: org.organizationId },
    });

    const call = vi.mocked(createTenantConnectAccount).mock.calls[0];
    expect((call[3] as { idempotencyKey: string }).idempotencyKey).toMatch(/-3$/);
  });

  it('concurrent owner /start calls produce exactly one Stripe account (race-safe)', async () => {
    vi.mocked(createTenantConnectAccount).mockImplementationOnce(async (orgId: string) => {
      await new Promise((r) => setTimeout(r, 200));
      return { id: `acct_test_${orgId.slice(0, 8)}` } as never;
    });

    const headers = bearerHeader(owner.accessToken);
    const reqBody = { organization_id: org.organizationId };

    const [a, b] = await Promise.all([
      callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody }),
      callRoute<{ account_id: string }>(POST, { method: 'POST', headers, body: reqBody }),
    ]);

    expect(vi.mocked(createTenantConnectAccount)).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.account_id).toBe(b.body.account_id);
  });

  it('releases the slot back to NULL when stripe.accounts.create throws', async () => {
    vi.mocked(createTenantConnectAccount).mockImplementationOnce(async () => {
      throw new Error('Stripe is down');
    });

    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { organization_id: org.organizationId },
    });
    expect(status).toBe(500);

    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', org.organizationId)
      .single();
    expect((orgRow as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBeNull();
  });

  // ---- Non-owner admin: read-only viewer, never creates ----

  it('admin (non-owner), org not connected: returns not_connected and creates nothing', async () => {
    const { status, body } = await callRoute<{ success: boolean; not_connected?: boolean; client_secret?: string }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(org.admin.accessToken),
        body: { organization_id: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.not_connected).toBe(true);
    expect(body.client_secret).toBeUndefined();
    expect(vi.mocked(createTenantConnectAccount)).not.toHaveBeenCalled();

    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', org.organizationId)
      .single();
    expect((orgRow as { stripe_connect_account_id: string | null }).stripe_connect_account_id).toBeNull();
  });

  it('admin (non-owner), org already connected: returns a VIEWER session without creating', async () => {
    const db = createTestSupabaseClient();
    // Unique per-org id so it can't collide with a UNIQUE constraint / stale rows.
    const acctId = `acct_test${org.organizationId.replace(/-/g, '').slice(0, 16)}`;
    const { error: updErr } = await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId })
      .eq('id', org.organizationId);
    if (updErr) throw new Error(`seed account id failed: ${updErr.message}`);

    const { status, body } = await callRoute<{ account_id: string; client_secret: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.account_id).toBe(acctId);
    expect(body.client_secret).toBe(`accs_viewer_${acctId}`);
    expect(vi.mocked(createTenantConnectAccount)).not.toHaveBeenCalled();
  });

  // ---- Manager: gated on can_manage_payments ----

  it('rejects a manager WITHOUT can_manage_payments (403)', async () => {
    const manager = await addManagerToOrg(org.organizationId, {});
    try {
      const { status } = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(manager.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(403);
    } finally {
      await manager.cleanup();
    }
  });

  it('manager WITH can_manage_payments gets a VIEWER session (connected), no create', async () => {
    const manager = await addManagerToOrg(org.organizationId, { can_manage_payments: true });
    const db = createTestSupabaseClient();
    const acctId = `acct_test${org.organizationId.replace(/-/g, '').slice(0, 16)}`;
    const { error: updErr } = await db
      .from('organizations')
      .update({ stripe_connect_account_id: acctId })
      .eq('id', org.organizationId);
    if (updErr) throw new Error(`seed account id failed: ${updErr.message}`);
    try {
      const { status, body } = await callRoute<{ account_id: string; client_secret: string }>(POST, {
        method: 'POST',
        headers: bearerHeader(manager.accessToken),
        body: { organization_id: org.organizationId },
      });
      expect(status).toBe(200);
      expect(body.account_id).toBe(acctId);
      expect(body.client_secret).toBe(`accs_viewer_${acctId}`);
      expect(vi.mocked(createTenantConnectAccount)).not.toHaveBeenCalled();
    } finally {
      await manager.cleanup();
    }
  });
});
