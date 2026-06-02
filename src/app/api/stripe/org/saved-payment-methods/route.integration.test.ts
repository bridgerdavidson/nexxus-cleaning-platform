import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * GET/DELETE /api/stripe/org/saved-payment-methods — the org's company card(s).
 *
 * Owner/admin or manager with can_manage_payments. An org with no self-pay Customer returns [].
 *
 * Per-file mock of the customers submodule (its real impl calls getStripe(), stubbed to throw by
 * the global setup). listSavedCards/detachPaymentMethod are stubbed to record calls; role/flag
 * rejections are asserted to short-circuit before any Stripe call.
 */
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  listSavedCards: vi.fn(async () => [
    { id: 'pm_org_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true },
  ]),
  detachPaymentMethod: vi.fn(async () => true),
}));

import { GET, DELETE } from './route';
import { listSavedCards, detachPaymentMethod } from '@/lib/stripe/customers/homeowner';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

const url = (org: string, extra = '') =>
  `http://test.local/api/stripe/org/saved-payment-methods?organization_id=${org}${extra}`;

describe('GET/DELETE /api/stripe/org/saved-payment-methods', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;
  let originalSelfPay: string | undefined;

  beforeEach(async () => {
    originalSelfPay = process.env.STRIPE_SELF_PAY_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_SELF_PAY_ENABLED = 'true';
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
    vi.mocked(listSavedCards).mockClear();
    vi.mocked(detachPaymentMethod).mockClear();
  });

  afterEach(async () => {
    process.env.STRIPE_SELF_PAY_ENABLED = originalSelfPay;
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  // Org-unique customer id (the partial UNIQUE index would otherwise collide with leaked rows).
  const orgCardCustomer = () => `cus_org_card_${org.organizationId.slice(0, 12)}`;
  async function giveOrgCard(customerId = orgCardCustomer()) {
    const db = createTestSupabaseClient();
    await db.from('organizations').update({ stripe_self_pay_customer_id: customerId }).eq('id', org.organizationId);
  }

  // ── GET ──────────────────────────────────────────────────────────────────────
  it('GET returns 404 when STRIPE_SELF_PAY_ENABLED is false', async () => {
    process.env.STRIPE_SELF_PAY_ENABLED = 'false';
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.organizationId),
    });
    expect(status).toBe(404);
    expect(vi.mocked(listSavedCards)).not.toHaveBeenCalled();
  });

  it('GET returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(GET, { method: 'GET', url: url(org.organizationId) });
    expect(status).toBe(401);
  });

  it('GET rejects a cleaner (403) before any Stripe call', async () => {
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.cleaner.accessToken),
      url: url(org.organizationId),
    });
    expect(status).toBe(403);
    expect(vi.mocked(listSavedCards)).not.toHaveBeenCalled();
  });

  it('GET rejects a non-member / cross-org caller (403)', async () => {
    await giveOrgCard();
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org2.admin.accessToken),
      url: url(org.organizationId),
    });
    expect(status).toBe(403);
    expect(vi.mocked(listSavedCards)).not.toHaveBeenCalled();
  });

  it('GET returns [] when the org has no self-pay customer yet (no Stripe call)', async () => {
    const { status, body } = await callRoute<{ cards: unknown[] }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.organizationId),
    });
    expect(status).toBe(200);
    expect(body.cards).toEqual([]);
    expect(vi.mocked(listSavedCards)).not.toHaveBeenCalled();
  });

  it('GET (admin) returns the org cards once a self-pay customer is on file', async () => {
    await giveOrgCard();
    const { status, body } = await callRoute<{ cards: Array<{ id: string; last4: string }> }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.organizationId),
    });
    expect(status).toBe(200);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ id: 'pm_org_1', last4: '4242' });
    expect(vi.mocked(listSavedCards)).toHaveBeenCalledWith(orgCardCustomer());
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────
  it('DELETE returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      url: url(org.organizationId, '&payment_method_id=pm_org_1'),
    });
    expect(status).toBe(401);
  });

  it('DELETE rejects a cleaner (403) before detaching', async () => {
    await giveOrgCard();
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.cleaner.accessToken),
      url: url(org.organizationId, '&payment_method_id=pm_org_1'),
    });
    expect(status).toBe(403);
    expect(vi.mocked(detachPaymentMethod)).not.toHaveBeenCalled();
  });

  it('DELETE returns 400 when payment_method_id is missing (authorized admin)', async () => {
    await giveOrgCard();
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.organizationId),
    });
    expect(status).toBe(400);
    expect(vi.mocked(detachPaymentMethod)).not.toHaveBeenCalled();
  });

  it('DELETE (admin) detaches the card from the org self-pay customer', async () => {
    await giveOrgCard();
    const { status, body } = await callRoute<{ success: boolean }>(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.organizationId, '&payment_method_id=pm_org_1'),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(detachPaymentMethod)).toHaveBeenCalledWith(orgCardCustomer(), 'pm_org_1');
  });

  it('DELETE returns 404 when the card is not on this org customer', async () => {
    await giveOrgCard();
    vi.mocked(detachPaymentMethod).mockResolvedValueOnce(false);
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      url: url(org.organizationId, '&payment_method_id=pm_not_here'),
    });
    expect(status).toBe(404);
  });
});
