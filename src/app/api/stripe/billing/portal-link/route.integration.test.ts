import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { createBillingPortalSession, resolvePortalConfiguration } = vi.hoisted(() => ({
  createBillingPortalSession: vi.fn(async () => ({ url: 'https://billing.stripe.test/session' })),
  // Echoes the variant it was asked for, so an assertion on the session's
  // `configuration` is an assertion about WHICH portal the caller reached.
  resolvePortalConfiguration: vi.fn(async (variant: string) => `bpc_${variant}`),
}));

vi.mock('@/lib/stripe/billing', () => ({
  createStripeBillingCustomer: vi.fn(async () => ({ id: `cus_test_${crypto.randomUUID()}` })),
  cancelStripeSubscription: vi.fn(async () => ({ id: 'sub_test', status: 'canceled' })),
  createBillingPortalSession,
  resolvePortalConfiguration,
}));

import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addOwnerToOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const BASE = 'http://test.local/api/stripe/billing/portal-link';
// APP_URL is not set in the integration env, and the route falls back to
// requireAppUrl() (which throws) when return_url is absent. Always pass one.
const RETURN = 'https://app.test/admin';

/** The `configuration` the route ended up creating the session with. */
function configurationUsed(): string {
  const calls = createBillingPortalSession.mock.calls as unknown as Array<[{ configuration: string }]>;
  return calls[calls.length - 1][0].configuration;
}

describe('GET /api/stripe/billing/portal-link', () => {
  let org: TestOrgFixture;
  let originalEnabled: string | undefined;

  beforeEach(async () => {
    originalEnabled = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    createBillingPortalSession.mockClear();
    resolvePortalConfiguration.mockClear();
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalEnabled;
    await org.cleanup();
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      url: `${BASE}?organization_id=${org.organizationId}`,
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.cleaner.accessToken),
      url: `${BASE}?organization_id=${org.organizationId}`,
    });
    expect(status).toBe(403);
  });

  it('rejects a manager, so no portal is opened for one at all', async () => {
    const manager = await addManagerToOrg(org.organizationId);
    try {
      const { status } = await callRoute(GET, {
        method: 'GET',
        headers: bearerHeader(manager.accessToken),
        url: `${BASE}?organization_id=${org.organizationId}`,
      });
      expect(status).toBe(403);
      expect(createBillingPortalSession).not.toHaveBeenCalled();
    } finally {
      await manager.cleanup();
    }
  });

  it('returns a portal URL for an admin and ensures the billing customer exists', async () => {
    const { status, body } = await callRoute<{ success: boolean; url: string }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: `${BASE}?organization_id=${org.organizationId}&return_url=https://app.test/admin-dashboard`,
    });
    expect(status).toBe(200);
    expect(body.url).toBe('https://billing.stripe.test/session');

    // The portal must run on OUR configuration: it is what disables plan changes
    // there (they belong in the app) and enables the cancellation-reason survey.
    expect(createBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: 'bpc_remediation' }),
    );

    const db = createTestSupabaseClient();
    const { data: o } = await db
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', org.organizationId)
      .single();
    expect((o as { stripe_customer_id: string }).stripe_customer_id).toMatch(/^cus_test_/);
  });

  // -------------------------------------------------------------------------
  // Ruling R24: which portal, and where that decision comes from.
  // -------------------------------------------------------------------------

  // Mutation target: "pass 'default' regardless of the role". An admin sent to
  // fix a failed card would land in the portal that can END the agreement,
  // which is the one thing ruling R15 v4 says an admin may never do.
  it('sends an admin to the remediation portal and the owner to the full one', async () => {
    const owner = await addOwnerToOrg(org.organizationId);
    try {
      await callRoute(GET, {
        method: 'GET',
        headers: bearerHeader(org.admin.accessToken),
        url: `${BASE}?organization_id=${org.organizationId}&return_url=${RETURN}`,
      });
      expect(configurationUsed(), 'admin').toBe('bpc_remediation');
      expect(resolvePortalConfiguration).toHaveBeenLastCalledWith('remediation');

      await callRoute(GET, {
        method: 'GET',
        headers: bearerHeader(owner.accessToken),
        url: `${BASE}?organization_id=${org.organizationId}&return_url=${RETURN}`,
      });
      expect(configurationUsed(), 'owner').toBe('bpc_default');
      expect(resolvePortalConfiguration).toHaveBeenLastCalledWith('default');
    } finally {
      await owner.cleanup();
    }
  });

  // Mutation target: "read the variant from the request". The role comes from
  // organization_members via requireOrgAuth; a client-supplied variant would
  // hand an admin the owner portal, cancel button and all, for the asking.
  it('ignores every variant hint in the request and uses the server-side role', async () => {
    const hints = [
      'variant=default',
      'portal=default',
      'configuration=bpc_default',
      'role=owner',
      'nexxus_portal=default',
    ].join('&');

    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: `${BASE}?organization_id=${org.organizationId}&return_url=${RETURN}&${hints}`,
    });

    expect(status).toBe(200);
    expect(configurationUsed()).toBe('bpc_remediation');
    expect(resolvePortalConfiguration).toHaveBeenCalledWith('remediation');
    expect(resolvePortalConfiguration).not.toHaveBeenCalledWith('default');
  });
});
