import { describe, expect, it, vi } from 'vitest';

// The real wrappers call getStripe(), which the global integration setup stubs
// to throw. Mocking the module (not getStripe) keeps the route's own line-item
// math, validation, and DB writes running for real.
vi.mock('@/lib/stripe/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe/billing')>()),
  createBillingCheckoutSession: vi.fn(async () => ({
    id: 'cs_test_123',
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
}));

import { POST } from './route';
import { createBillingCheckoutSession } from '@/lib/stripe/billing';
import { createAuthUser, withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();
const sessionMock = vi.mocked(createBillingCheckoutSession);

// APP_URL is not in .env.test.local, and requireAppUrl() throws without it.
// The route reads it per request, never at import time, so setting it here is
// enough. `||=` so a file that pins its own value keeps it.
process.env.APP_URL ||= 'https://app.test.local';

interface CheckoutResponse {
  success?: boolean;
  data?: { checkout_url?: string };
  error?: string;
}

const checkout = (token: string, body: Record<string, unknown>) =>
  callRoute<CheckoutResponse>(POST, { method: 'POST', headers: bearerHeader(token), body });

/** A real cleaner member: organization_members.user_id is FK'd to user_profiles → auth.users. */
async function addCleanerMember(organizationId: string, index: number) {
  const user = await createAuthUser(
    `seatcleaner-${index}-${crypto.randomUUID().slice(0, 8)}@test.local`,
    'cleaner',
    'Seat',
  );
  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert(
      { id: user.id, email: user.email, first_name: 'Seat', last_name: 'Cleaner', role: 'cleaner' },
      { onConflict: 'id' },
    );
  if (profileError) throw new Error(`seat cleaner profile failed: ${profileError.message}`);

  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({ organization_id: organizationId, user_id: user.id, role: 'cleaner' });
  if (memberError) throw new Error(`seat cleaner member failed: ${memberError.message}`);

  return {
    userId: user.id,
    cleanup: () => supabase.auth.admin.deleteUser(user.id).then(() => undefined),
  };
}

describe('POST /api/billing/checkout', () => {
  it('returns a checkout url for a valid purchase', async () => {
    const org = await withTestOrg();
    try {
      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'growth',
        period: 'annual',
        seat_count: 8,
      });
      expect(res.status).toBe(200);
      expect(res.body.data?.checkout_url).toBe('https://checkout.stripe.test/session');
    } finally {
      await org.cleanup();
    }
  });

  it('builds line items with a seat line only when there are extras', async () => {
    const org = await withTestOrg();
    try {
      sessionMock.mockClear();
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(sessionMock.mock.calls[0][0].lineItems).toEqual([{ price: 'p_sm', quantity: 1 }]);

      sessionMock.mockClear();
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 5,
      });
      expect(sessionMock.mock.calls[0][0].lineItems).toEqual([
        { price: 'p_sm', quantity: 1 },
        { price: 'p_esm', quantity: 2 },
      ]);
    } finally {
      await org.cleanup();
    }
  });

  it('never passes automatic_tax while the tax flag is off, and always collects an address', async () => {
    const org = await withTestOrg();
    try {
      sessionMock.mockClear();
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      const input = sessionMock.mock.calls[0][0];
      expect(input.automaticTax).toBe(false);
      expect(input.successUrl.startsWith('https://app.test.local/')).toBe(true);
      expect(input.cancelUrl.startsWith('https://app.test.local/')).toBe(true);
    } finally {
      await org.cleanup();
    }
  });

  it('sends automatic_tax once the tax flag is on', async () => {
    process.env.BILLING_TAX_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      sessionMock.mockClear();
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(sessionMock.mock.calls[0][0].automaticTax).toBe(true);
    } finally {
      delete process.env.BILLING_TAX_ENABLED;
      await org.cleanup();
    }
  });

  // A second Checkout Session against the same customer opens a SECOND
  // subscription. The webhook then overwrites organizations.subscription_id and
  // orphans the first one, which keeps billing with nothing pointing at it.
  it.each(['active', 'past_due', 'unpaid'])(
    'refuses with 409 when the org is already %s',
    async (status) => {
      const org = await withTestOrg();
      try {
        await supabase
          .from('organizations')
          .update({ subscription_id: 'sub_test_existing', subscription_status: status })
          .eq('id', org.organizationId);
        sessionMock.mockClear();

        const res = await checkout(org.admin.accessToken, {
          organization_id: org.organizationId,
          tier: 'growth',
          period: 'monthly',
          seat_count: 8,
        });

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/already has a subscription/i);
        expect(sessionMock).not.toHaveBeenCalled();
      } finally {
        await org.cleanup();
      }
    },
  );

  it('still sells to an org whose old subscription is canceled', async () => {
    const org = await withTestOrg();
    try {
      await supabase
        .from('organizations')
        .update({ subscription_id: 'sub_test_dead', subscription_status: 'canceled' })
        .eq('id', org.organizationId);

      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(200);
    } finally {
      await org.cleanup();
    }
  });

  it('403s, not 404s, for an org the caller does not belong to', async () => {
    // The membership check runs first, so an outsider never learns whether the
    // organization exists, let alone whether it is paying. The route's 404 branch
    // is reachable only if the row disappears between the two reads.
    const org = await withTestOrg();
    try {
      const res = await checkout(org.admin.accessToken, {
        organization_id: crypto.randomUUID(),
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it('works for a frozen org, because a frozen org must be able to pay', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg({
      billing: { trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() },
    });
    try {
      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(200);
    } finally {
      delete process.env.BILLING_ENFORCEMENT_ENABLED;
      await org.cleanup();
    }
  });

  it.each<[Record<string, unknown>, RegExp]>([
    [{ tier: 'starter', period: 'monthly', seat_count: 2 }, /at least 3/i],
    [{ tier: 'starter', period: 'monthly', seat_count: 6 }, /at most 5/i],
    [{ tier: 'enterprise', period: 'monthly', seat_count: 3 }, /tier/i],
    [{ tier: 'starter', period: 'weekly', seat_count: 3 }, /period/i],
    [{ tier: 'starter', period: 'monthly', seat_count: 3.5 }, /whole number/i],
  ])('rejects %j with 400', async (body, message) => {
    const org = await withTestOrg();
    try {
      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        ...body,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    } finally {
      await org.cleanup();
    }
  });

  it('refuses to buy fewer seats than are in use', async () => {
    const org = await withTestOrg(); // fixture creates one cleaner
    const extras: Array<{ cleanup: () => Promise<void> }> = [];
    try {
      // Starter's minimum is 3, so 4 cleaners is the smallest case where a
      // legal seat count still undersells the organization.
      for (let i = 0; i < 3; i++) {
        extras.push(await addCleanerMember(org.organizationId, i));
      }
      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/4/);
    } finally {
      await org.cleanup();
      await Promise.all(extras.map((e) => e.cleanup()));
    }
  });

  it('is owner or admin only', async () => {
    const org = await withTestOrg();
    try {
      const res = await checkout(org.cleaner.accessToken, {
        organization_id: org.organizationId,
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it('writes an app.checkout_started audit row', async () => {
    const org = await withTestOrg();
    try {
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId,
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });
      const { data } = await supabase
        .from('tenant_subscription_events')
        .select('event_type')
        .eq('organization_id', org.organizationId);
      expect(data?.map((r) => r.event_type)).toContain('app.checkout_started');
    } finally {
      await org.cleanup();
    }
  });
});
