import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

// Same mocking shape as the checkout route's spec: the real wrappers call
// getStripe(), which the global integration setup stubs to throw. Everything
// else (validation, the item diff, the DB mirror, the audit row) runs for real.
vi.mock('@/lib/stripe/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe/billing')>()),
  createBillingCheckoutSession: vi.fn(async () => ({
    id: 'cs_test_plan',
    url: 'https://checkout.stripe.test/session',
  })),
  resolvePrices: vi.fn(async () => ({
    starter_monthly: 'p_sm',
    starter_annual: 'p_sa',
    growth_monthly: 'p_gm',
    growth_annual: 'p_ga',
    pro_monthly: 'p_pm',
    pro_annual: 'p_pa',
    extra_seat_monthly: 'p_esm',
    extra_seat_annual: 'p_esa',
  })),
  createStripeBillingCustomer: vi.fn(async () => ({ id: `cus_${crypto.randomUUID()}` })),
  retrieveSubscription: vi.fn(async () => ({ id: 'sub_test_live', items: { data: [] } })),
  updateSubscriptionItems: vi.fn(async () => ({ id: 'sub_test_live', status: 'active' })),
}));

import { POST } from './route';
import {
  createBillingCheckoutSession,
  retrieveSubscription,
  updateSubscriptionItems,
} from '@/lib/stripe/billing';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();
const retrieveMock = vi.mocked(retrieveSubscription);
const updateMock = vi.mocked(updateSubscriptionItems);
const checkoutMock = vi.mocked(createBillingCheckoutSession);

// APP_URL is not in .env.test.local and requireAppUrl() throws without it. The
// route reads it per request, never at import time.
process.env.APP_URL ||= 'https://app.test.local';

interface PlanResponse {
  success?: boolean;
  data?: { updated?: boolean; checkout_url?: string };
  error?: string;
}

const changePlan = (token: string, body: Record<string, unknown>) =>
  callRoute<PlanResponse>(POST, { method: 'POST', headers: bearerHeader(token), body });

/**
 * withTestOrg()'s `admin` handle is seeded as org role 'admin', not 'owner'.
 * This route is owner only (an admin may open checkout but may not change an
 * existing plan), so every test that expects a successful change promotes that
 * member rather than weakening the route. Same approach as the trial-extend spec.
 */
async function promoteToOwner(organizationId: string, userId: string) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role: 'owner' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error) throw new Error(`promote to owner failed: ${error.message}`);
}

/** Put the org in a state where a subscription exists to change. */
async function withLiveSubscription(organizationId: string, status = 'active') {
  const { error } = await supabase
    .from('organizations')
    .update({ subscription_id: 'sub_test_live', subscription_status: status })
    .eq('id', organizationId);
  if (error) throw new Error(`live subscription setup failed: ${error.message}`);
}

/** What Stripe hands back on retrieve: lookup keys ride along on the items. */
function stubSubscription(items: Array<{ id: string; lookup: string; quantity?: number }>) {
  retrieveMock.mockResolvedValue({
    id: 'sub_test_live',
    items: {
      data: items.map((i) => ({
        id: i.id,
        price: { lookup_key: i.lookup },
        quantity: i.quantity ?? 1,
      })),
    },
  } as unknown as Stripe.Subscription);
}

describe('POST /api/billing/plan', () => {
  it('upgrades tier in one call, with the diffed items', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId);
      stubSubscription([{ id: 'si_base', lookup: 'starter_monthly' }]);
      updateMock.mockClear();

      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'growth',
        period: 'monthly',
        seat_count: 10,
      });

      expect(res.status).toBe(200);
      expect(res.body.data?.updated).toBe(true);
      expect(updateMock).toHaveBeenCalledTimes(1);
      // Base price swapped in place; a seat line opened for the two extras.
      // proration_behavior: 'create_prorations' lives in the wrapper itself.
      expect(updateMock.mock.calls[0][0]).toBe('sub_test_live');
      expect(updateMock.mock.calls[0][1]).toEqual([
        { id: 'si_base', price: 'p_gm' },
        { price: 'p_esm', quantity: 2 },
      ]);
      expect(updateMock.mock.calls[0][2]).toBe(org.organizationId);
    } finally {
      await org.cleanup();
    }
  });

  it('swaps both prices on a monthly to annual switch', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId);
      stubSubscription([
        { id: 'si_base', lookup: 'starter_monthly' },
        { id: 'si_seat', lookup: 'extra_seat_monthly', quantity: 2 },
      ]);
      updateMock.mockClear();

      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'annual',
        seat_count: 5,
      });

      expect(res.status).toBe(200);
      expect(updateMock.mock.calls[0][1]).toEqual([
        { id: 'si_base', price: 'p_sa' },
        { id: 'si_seat', price: 'p_esa', quantity: 2 },
      ]);
    } finally {
      await org.cleanup();
    }
  });

  it('deletes the seat line when a downgrade leaves no extras', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId);
      stubSubscription([
        { id: 'si_base', lookup: 'starter_monthly' },
        { id: 'si_seat', lookup: 'extra_seat_monthly', quantity: 2 },
      ]);
      updateMock.mockClear();

      await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });

      expect(updateMock.mock.calls[0][1]).toEqual([
        { id: 'si_base', price: 'p_sm' },
        { id: 'si_seat', deleted: true },
      ]);
    } finally {
      await org.cleanup();
    }
  });

  it('mirrors plan_tier, billing_period, and seat_count, and writes an audit row', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId);
      stubSubscription([{ id: 'si_base', lookup: 'starter_monthly' }]);

      await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'growth',
        period: 'annual',
        seat_count: 12,
      });

      const { data } = await supabase
        .from('organizations')
        .select('plan_tier, billing_period, seat_count')
        .eq('id', org.organizationId)
        .single();
      expect(data).toMatchObject({ plan_tier: 'growth', billing_period: 'annual', seat_count: 12 });

      const { data: events } = await supabase
        .from('tenant_subscription_events')
        .select('event_type')
        .eq('organization_id', org.organizationId);
      expect(events?.map((r) => r.event_type)).toContain('app.plan_changed');
    } finally {
      await org.cleanup();
    }
  });

  it('still works for an unpaid org, because changing plan is not a write we freeze', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId, 'unpaid');
      stubSubscription([{ id: 'si_base', lookup: 'growth_monthly' }]);

      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(200);
      expect(res.body.data?.updated).toBe(true);
    } finally {
      delete process.env.BILLING_ENFORCEMENT_ENABLED;
      await org.cleanup();
    }
  });

  it('returns a checkout url instead of erroring when there is no live subscription', async () => {
    const org = await withTestOrg(); // trialing, subscription_id null
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      updateMock.mockClear();
      checkoutMock.mockClear();

      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });

      expect(res.status).toBe(200);
      expect(res.body.data?.checkout_url).toBe('https://checkout.stripe.test/session');
      expect(updateMock).not.toHaveBeenCalled();
      expect(checkoutMock.mock.calls[0][0].lineItems).toEqual([{ price: 'p_gm', quantity: 1 }]);
    } finally {
      await org.cleanup();
    }
  });

  it('returns a checkout url for a canceled subscription too', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId, 'canceled');
      updateMock.mockClear();

      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });

      expect(res.status).toBe(200);
      expect(res.body.data?.checkout_url).toBe('https://checkout.stripe.test/session');
      expect(updateMock).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });

  it('is owner only, so an admin gets 403', async () => {
    const org = await withTestOrg();
    try {
      await withLiveSubscription(org.organizationId);
      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a cleaner too', async () => {
    const org = await withTestOrg();
    try {
      const res = await changePlan(org.cleaner.accessToken, {
        organization_id: org.organizationId,
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it.each<[Record<string, unknown>, RegExp]>([
    [{ tier: 'starter', period: 'monthly', seat_count: 2 }, /at least 3/i],
    [{ tier: 'starter', period: 'monthly', seat_count: 6 }, /at most 5/i],
    [{ tier: 'enterprise', period: 'monthly', seat_count: 3 }, /tier/i],
    [{ tier: 'starter', period: 'weekly', seat_count: 3 }, /period/i],
    [{ tier: 'starter', period: 'monthly', seat_count: 3.5 }, /whole number/i],
  ])('rejects %j with 400, matching checkout', async (body, message) => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId);
      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        ...body,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    } finally {
      await org.cleanup();
    }
  });

  it('refuses to move to fewer seats than are in use', async () => {
    const org = await withTestOrg(); // fixture creates one cleaner
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId);
      await supabase.from('invites').insert(
        ['a', 'b', 'c'].map((suffix) => ({
          organization_id: org.organizationId,
          email: `seat-${suffix}-${crypto.randomUUID().slice(0, 8)}@test.local`,
          role: 'cleaner',
          status: 'pending',
          invited_by: org.admin.userId,
        })),
      );

      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/4/);
    } finally {
      await org.cleanup();
    }
  });

  it('400s without an organization id and 401s without a token', async () => {
    const org = await withTestOrg();
    try {
      expect(
        (
          await changePlan(org.admin.accessToken, {
            tier: 'starter',
            period: 'monthly',
            seat_count: 3,
          })
        ).status,
      ).toBe(400);

      expect(
        (
          await callRoute<PlanResponse>(POST, {
            method: 'POST',
            body: {
              organization_id: org.organizationId,
              tier: 'starter',
              period: 'monthly',
              seat_count: 3,
            },
          })
        ).status,
      ).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it('refuses a subscription with no plan line it recognizes', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await withLiveSubscription(org.organizationId);
      stubSubscription([{ id: 'si_mystery', lookup: 'legacy_thing' }]);
      updateMock.mockClear();

      const res = await changePlan(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/no plan line/i);
      expect(updateMock).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });
});
