import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/stripe/customers/homeowner', () => ({
  listSavedCards: vi.fn(async () => [
    { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 9, expYear: 2030, isDefault: true },
  ]),
}));

import { GET } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const url = (homeownerId: string, orgId: string) =>
  `http://test.local/api/stripe/saved-payment-methods?homeowner_id=${homeownerId}&organization_id=${orgId}`;

describe('GET /api/stripe/saved-payment-methods', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    originalFlag = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlag;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(GET, { method: 'GET', url: url(org.homeowner.userId, org.organizationId) });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.cleaner.accessToken),
      url: url(org.homeowner.userId, org.organizationId),
    });
    expect(status).toBe(403);
  });

  it('rejects a cross-org caller (org2 admin on org1)', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org2.admin.accessToken),
      url: url(org.homeowner.userId, org.organizationId),
    });
    expect(status).toBe(403);
  });

  it('404 when the homeowner is not associated with the org', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org2.homeowner.userId, org.organizationId), // org2's homeowner, org1 admin
    });
    expect(status).toBe(404);
  });

  it('returns an empty list when the homeowner has no Stripe customer', async () => {
    const { status, body } = await callRoute<{ cards: unknown[] }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.homeowner.userId, org.organizationId),
    });
    expect(status).toBe(200);
    expect(body.cards).toEqual([]);
  });

  it('returns masked saved cards for an associated homeowner with a customer', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_saved_cards' })
      .eq('id', org.homeowner.userId);

    const { status, body } = await callRoute<{ cards: Array<{ last4: string; brand: string }> }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.homeowner.userId, org.organizationId),
    });
    expect(status).toBe(200);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].last4).toBe('4242');
    expect(body.cards[0].brand).toBe('visa');
  });
});
