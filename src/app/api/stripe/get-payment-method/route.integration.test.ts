import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';

/**
 * Security audit C5: this route returned a homeowner's saved-card brand/last4 for any
 * homeowner_id with NO authentication. It now requires the homeowner themselves or org
 * staff who share the org (requireSelfOrOrgStaff).
 *
 * The happy paths use a homeowner with no stripe_customer_id, so the route returns
 * has_card:false BEFORE touching Stripe (which the integration setup stubs to throw).
 */
describe('POST /api/stripe/get-payment-method (auth)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let prevStripeEnabled: string | undefined;

  beforeEach(async () => {
    prevStripeEnabled = process.env.STRIPE_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = prevStripeEnabled;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner acting on a homeowner (403)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { homeowner_id: org.homeowner.userId, organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it("rejects staff acting on another org's homeowner (404, no existence leak)", async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { homeowner_id: org.homeowner.userId, organization_id: org2.organizationId },
    });
    expect(status).toBe(404);
  });

  it('allows the homeowner themselves (200, has_card:false with no saved card)', async () => {
    const { status, body } = await callRoute<{ success: boolean; has_card: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { homeowner_id: org.homeowner.userId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.has_card).toBe(false);
  });

  it('allows org staff acting on their own homeowner (200)', async () => {
    const { status, body } = await callRoute<{ success: boolean; has_card: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { homeowner_id: org.homeowner.userId, organization_id: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.has_card).toBe(false);
  });
});
