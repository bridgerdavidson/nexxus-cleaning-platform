import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

// Same mocking shape as the apply route's spec: the real wrappers call
// getStripe(), which the global integration setup stubs to throw. Everything
// else (validation, the seat rules, the item diff, the money arithmetic) runs
// for real. importOriginal keeps the module's other exports alive, because
// @/lib/payments/orgBilling imports several of them.
vi.mock('@/lib/stripe/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe/billing')>()),
  previewSubscriptionChange: vi.fn(),
  retrieveSubscription: vi.fn(),
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
}));

import { POST } from './route';
import type { PlanPreviewPayload } from './route';
import { previewSubscriptionChange, resolvePrices, retrieveSubscription } from '@/lib/stripe/billing';
import { renewalNoteFor, totalRowFor } from '@/components/redesign/billing/planPickerModel';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();
const previewMock = vi.mocked(previewSubscriptionChange);
const retrieveMock = vi.mocked(retrieveSubscription);
const pricesMock = vi.mocked(resolvePrices);

interface PreviewResponse {
  success?: boolean;
  data?: PlanPreviewPayload;
  error?: string;
  message?: string;
  state?: string;
}

/** withTestOrg seeds `admin` as org role 'admin'. This route is owner only. */
async function promoteToOwner(organizationId: string, userId: string) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role: 'owner' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error) throw new Error(`promote to owner failed: ${error.message}`);
}

function preview(token: string, organizationId: string, body: Record<string, unknown>) {
  return callRoute<PreviewResponse>(POST, {
    method: 'POST',
    headers: bearerHeader(token),
    body: { organization_id: organizationId, ...body },
  });
}

/** A live Growth-monthly subscription on 8 seats. */
const LIVE_BILLING = {
  subscription_status: 'active',
  subscription_id: 'sub_live',
  stripe_customer_id: 'cus_1',
  plan_tier: 'growth',
  billing_period: 'monthly',
  seat_count: 8,
};

/** What retrieveSubscription hands back: one Growth-monthly base line, no seat line. */
function stubGrowthMonthlySubscription() {
  retrieveMock.mockResolvedValue({
    id: 'sub_live',
    items: { data: [{ id: 'si_base', quantity: 1, price: { lookup_key: 'growth_monthly' } }] },
  } as unknown as Stripe.Subscription);
}

/** The same org a year on: a live Growth ANNUAL subscription on 8 seats. */
const LIVE_ANNUAL_BILLING = { ...LIVE_BILLING, billing_period: 'annual' };

function stubGrowthAnnualSubscription() {
  retrieveMock.mockResolvedValue({
    id: 'sub_live',
    items: { data: [{ id: 'si_base', quantity: 1, price: { lookup_key: 'growth_annual' } }] },
  } as unknown as Stripe.Subscription);
}

const NEXT_ATTEMPT = 1_792_000_000;

interface LineSpec {
  amount: number;
  /** 'now' rides the change, 'next' belongs to the following invoice. */
  when: 'now' | 'next';
  tax?: number;
}

/**
 * A preview invoice in the shape Stripe really returns: the proration lines AND
 * the next period's lines on ONE invoice, so `amount_due` is deliberately larger
 * than what an always_invoice update charges today. A route that quotes
 * amount_due fails every test that uses this.
 */
function previewInvoice(spec: {
  lines: LineSpec[];
  amountDue: number;
  totalTaxes?: number[];
  nextPaymentAttempt?: number | null;
  startingBalance?: number;
}): Stripe.Invoice {
  const now = Math.floor(Date.now() / 1000);
  return {
    amount_due: spec.amountDue,
    total: spec.amountDue,
    starting_balance: spec.startingBalance ?? 0,
    total_taxes: (spec.totalTaxes ?? []).map((amount) => ({ amount })),
    next_payment_attempt:
      spec.nextPaymentAttempt === undefined ? NEXT_ATTEMPT : spec.nextPaymentAttempt,
    lines: {
      has_more: false,
      data: spec.lines.map((l) => ({
        amount: l.amount,
        // 'now' lines start a minute before the preview's proration date, which
        // is computed inside the route; 'next' lines start well after it.
        period:
          l.when === 'now'
            ? { start: now - 60, end: now + 15 * 86_400 }
            : { start: now + 15 * 86_400, end: now + 45 * 86_400 },
        taxes: l.tax === undefined ? null : [{ amount: l.tax, tax_behavior: 'exclusive' }],
      })),
    },
  } as unknown as Stripe.Invoice;
}

/**
 * Growth monthly (99.00) to Pro monthly (169.00) half way through the period at
 * 8% tax: 37.80 is billed today, 182.52 recurs, and 222.32 is the whole upcoming
 * invoice, which is NOT what the customer is charged now.
 */
const UPGRADE_PREVIEW = () =>
  previewInvoice({
    amountDue: 22232,
    totalTaxes: [1632],
    lines: [
      { amount: -4950, when: 'now', tax: -396 },
      { amount: 8450, when: 'now', tax: 676 },
      { amount: 16900, when: 'next', tax: 1352 },
    ],
  });

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/billing/plan/preview', () => {
  it('quotes what an upgrade is charged today, tax included, not the whole upcoming invoice', async () => {
    vi.stubEnv('BILLING_TAX_ENABLED', 'true');
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(UPGRADE_PREVIEW());

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });

      expect(res.status).toBe(200);
      const data = res.body.data!;
      expect(data.due_now_cents).toBe(3780);
      expect(data.tax_cents).toBe(280);
      expect(data.recurring_cents).toBe(18252);
      expect(data.tax_excluded).toBe(false);
      expect(data.is_new_subscription).toBe(false);
      expect(data.direction).toBe('upgrade');
      expect(data.next_charge_at).toBe(new Date(NEXT_ATTEMPT * 1000).toISOString());
    } finally {
      await org.cleanup();
    }
  });

  it('previews the exact items the apply route would send, with tax on the same condition', async () => {
    vi.stubEnv('BILLING_TAX_ENABLED', 'true');
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(UPGRADE_PREVIEW());

      await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'monthly',
        seat_count: 12,
      });

      expect(previewMock).toHaveBeenCalledTimes(1);
      const input = previewMock.mock.calls[0][0];
      expect(input.subscriptionId).toBe('sub_live');
      // Base price kept, a seat line opened for the four extras: byte for byte
      // what diffSubscriptionItems hands updateSubscriptionItems.
      expect(input.items).toEqual([
        { id: 'si_base', price: 'p_gm' },
        { price: 'p_esm', quantity: 4 },
      ]);
      expect(input.automaticTax).toBe(true);
      expect(input.prorationDate).toBeGreaterThan(1_700_000_000);
      expect(input.prorationDate).toBeLessThan(Math.floor(Date.now() / 1000) + 5);
    } finally {
      await org.cleanup();
    }
  });

  it('passes automaticTax false and quotes no tax while the tax flag is off', async () => {
    vi.stubEnv('BILLING_TAX_ENABLED', 'false');
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(
        previewInvoice({
          amountDue: 20600,
          lines: [
            { amount: -4950, when: 'now' },
            { amount: 8450, when: 'now' },
            { amount: 16900, when: 'next' },
          ],
        }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });

      expect(previewMock.mock.calls[0][0].automaticTax).toBe(false);
      const data = res.body.data!;
      expect(data.due_now_cents).toBe(3500);
      expect(data.tax_cents).toBe(0);
      expect(data.tax_excluded).toBe(true);
      expect(data.recurring_cents).toBe(16900);
    } finally {
      await org.cleanup();
    }
  });

  // Ruling R21 v2 removed the forced zero, so this case has to reach zero on its
  // own arithmetic, and it does: a same-interval tier downgrade credits more
  // unused Growth time than it charges for the rest of the period at Starter,
  // and summarizePreviewInvoice floors the negative at zero. The route no longer
  // has a thumb on this scale, which is what makes it worth asserting.
  it('reports zero for a pure tier downgrade, whose prorations net out to a credit', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(
        previewInvoice({
          amountDue: 3900,
          lines: [
            { amount: -4950, when: 'now' },
            { amount: 1950, when: 'now' },
            { amount: 3900, when: 'next' },
          ],
        }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });

      const data = res.body.data!;
      expect(data.direction).toBe('downgrade');
      expect(data.due_now_cents).toBe(0);
      expect(data.tax_cents).toBe(0);
      expect(data.recurring_cents).toBe(3900);
      expect(data.next_charge_at).toBe(new Date(NEXT_ATTEMPT * 1000).toISOString());
      // And the screen says so in words, from that same zero.
      expect(totalRowFor(data).label).toBe('Nothing is charged today');
    } finally {
      await org.cleanup();
    }
  });

  // THE CASE RULING R21 v2 EXISTS FOR. Changing the interval resets the billing
  // cycle, so the new monthly period is invoiced on the spot as a line starting
  // at the proration date. Late in the annual term the credit for unused time is
  // small, so real money is due, while directionOf still calls this a downgrade
  // (the per-cycle price falls from $948 to $99). v1 forced that to zero and the
  // purchase screen said "Nothing is charged today" over a live charge.
  it('bills an annual to monthly switch today, and never calls it nothing', async () => {
    const org = await withTestOrg({ billing: LIVE_ANNUAL_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthAnnualSubscription();
      previewMock.mockResolvedValue(
        previewInvoice({
          amountDue: 8900,
          lines: [
            // A month left on the year: a small credit, netted against the new
            // period's charge on the same invoice.
            { amount: -1000, when: 'now' },
            { amount: 9900, when: 'now' },
          ],
        }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });

      const data = res.body.data!;
      expect(data.direction).toBe('downgrade');
      expect(data.due_now_cents).toBe(8900);
      // No future-period line in this preview, so the catalogue prices the renewal.
      expect(data.recurring_cents).toBe(9900);

      // The copy this payload produces, end to end. A screen that says nothing is
      // charged while Stripe invoices $89.00 is the whole bug.
      const row = totalRowFor(data);
      expect(row.label).toBe('Charged today');
      expect(row.cents).toBe(8900);
      const note = renewalNoteFor({ preview: data, period: 'monthly' });
      expect(`${row.label} ${note}`.toLowerCase()).not.toContain('nothing is charged');
    } finally {
      await org.cleanup();
    }
  });

  // The tax half of ruling R21 v2. v1 gated tax on the same forced zero, so a
  // downgrade that IS billed today would have quoted a tax-inclusive total with
  // its tax line reported as nothing.
  it('quotes the tax inside a downgrade that is billed today', async () => {
    vi.stubEnv('BILLING_TAX_ENABLED', 'true');
    const org = await withTestOrg({ billing: LIVE_ANNUAL_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthAnnualSubscription();
      previewMock.mockResolvedValue(
        previewInvoice({
          amountDue: 9612,
          totalTaxes: [712],
          lines: [
            { amount: -1000, when: 'now', tax: -80 },
            { amount: 9900, when: 'now', tax: 792 },
          ],
        }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });

      const data = res.body.data!;
      expect(data.direction).toBe('downgrade');
      expect(data.due_now_cents).toBe(9612);
      expect(data.tax_cents).toBe(712);
      expect(data.tax_excluded).toBe(false);
    } finally {
      await org.cleanup();
    }
  });

  it('charges nothing for a change that costs exactly the same', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(
        previewInvoice({ amountDue: 9900, lines: [{ amount: 9900, when: 'next' }] }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });

      expect(res.body.data!.direction).toBe('unchanged');
      // Every line belongs to the next period, so the due-now bucket is empty
      // without anything forcing it.
      expect(res.body.data!.due_now_cents).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  // Switching to annual resets the billing cycle, so the year is billed on the
  // spot as a NON-proration line. This is the largest charge we ever make.
  it('bills the full year when the switch to annual resets the cycle', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(
        previewInvoice({
          amountDue: 92325,
          lines: [
            { amount: -2475, when: 'now' },
            { amount: 94800, when: 'now' },
          ],
        }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'annual',
        seat_count: 8,
      });

      const data = res.body.data!;
      expect(data.direction).toBe('upgrade');
      expect(data.due_now_cents).toBe(92325);
      // No future-period line in the preview, so the catalogue prices the renewal.
      expect(data.recurring_cents).toBe(94800);
    } finally {
      await org.cleanup();
    }
  });

  it('spends an existing credit balance before quoting a charge', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(
        previewInvoice({
          amountDue: 18400,
          startingBalance: -2000,
          lines: [
            { amount: -4950, when: 'now' },
            { amount: 8450, when: 'now' },
            { amount: 16900, when: 'next' },
          ],
        }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });

      expect(res.body.data!.due_now_cents).toBe(1500);
    } finally {
      await org.cleanup();
    }
  });

  it('returns no next charge date when Stripe supplies none', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(
        previewInvoice({
          amountDue: 3500,
          nextPaymentAttempt: null,
          lines: [{ amount: 3500, when: 'now' }],
        }),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });

      expect(res.body.data!.next_charge_at).toBeNull();
    } finally {
      await org.cleanup();
    }
  });

  it('never mutates the org row and writes no billing event', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();
      previewMock.mockResolvedValue(UPGRADE_PREVIEW());

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });
      expect(res.status).toBe(200);

      const { data: after } = await supabase
        .from('organizations')
        .select('plan_tier, billing_period, seat_count, subscription_status, subscription_id')
        .eq('id', org.organizationId)
        .single();
      expect(after).toMatchObject({
        plan_tier: 'growth',
        billing_period: 'monthly',
        seat_count: 8,
        subscription_status: 'active',
        subscription_id: 'sub_live',
      });

      // The apply route writes app.plan_changed here. A preview writes nothing.
      const { data: events } = await supabase
        .from('tenant_subscription_events')
        .select('event_type')
        .eq('organization_id', org.organizationId);
      expect(events ?? []).toHaveLength(0);
    } finally {
      await org.cleanup();
    }
  });

  it('prices a first purchase from the catalogue without calling Stripe', async () => {
    // Fixture default: live trial, no subscription_id.
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'monthly',
        seat_count: 8,
      });

      expect(res.status).toBe(200);
      const data = res.body.data!;
      expect(data.is_new_subscription).toBe(true);
      expect(data.due_now_cents).toBe(9900);
      expect(data.recurring_cents).toBe(9900);
      expect(data.tax_excluded).toBe(true);
      expect(data.tax_cents).toBe(0);
      expect(data.next_charge_at).toBeNull();
      expect(data.direction).toBe('upgrade');
      expect(previewMock).not.toHaveBeenCalled();
      expect(retrieveMock).not.toHaveBeenCalled();
      expect(pricesMock).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });

  it('prices a first purchase of an annual plan as the whole year', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'annual',
        seat_count: 10,
      });

      // 79.00 x 12 plus two seats at 120.00 a year.
      expect(res.body.data!.due_now_cents).toBe(118800);
      expect(res.body.data!.recurring_cents).toBe(118800);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a seat count below the tier floor', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'growth',
        period: 'monthly',
        seat_count: 2,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at least 8/i);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a seat count above the tier maximum', async () => {
    const org = await withTestOrg();
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'starter',
        period: 'monthly',
        seat_count: 99,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at most 5/i);
    } finally {
      await org.cleanup();
    }
  });

  // Quoting a price for a change POST /api/billing/plan would refuse is the
  // drift this endpoint exists to avoid.
  it('refuses to price fewer seats than are in use, exactly as the apply route does', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING }); // fixture creates one cleaner
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await supabase.from('invites').insert(
        ['a', 'b', 'c'].map((suffix) => ({
          organization_id: org.organizationId,
          email: `seat-${suffix}-${crypto.randomUUID().slice(0, 8)}@test.local`,
          role: 'cleaner',
          status: 'pending',
          invited_by: org.admin.userId,
        })),
      );

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'starter',
        period: 'monthly',
        seat_count: 3,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/4/);
      expect(previewMock).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });

  it.each(['past_due', 'unpaid'])('refuses a %s org with 409, matching the apply route', async (status) => {
    const org = await withTestOrg({ billing: { ...LIVE_BILLING, subscription_status: status } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      stubGrowthMonthlySubscription();

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('billing_payment_required');
      expect(res.body.message).toBe('Please update your payment method before changing your plan.');
      expect(previewMock).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a non-owner', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });
      expect(res.status).toBe(403);
      expect(previewMock).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a cleaner too', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      const res = await preview(org.cleaner.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it.each<[Record<string, unknown>, RegExp]>([
    [{ tier: 'enterprise', period: 'monthly', seat_count: 3 }, /tier/i],
    [{ tier: 'starter', period: 'weekly', seat_count: 3 }, /period/i],
    [{ tier: 'starter', period: 'monthly', seat_count: 3.5 }, /whole number/i],
  ])('rejects %j with 400, matching the apply route', async (body, message) => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      const res = await preview(org.admin.accessToken, org.organizationId, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    } finally {
      await org.cleanup();
    }
  });

  it('400s without an organization id and 401s without a token', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      expect(
        (
          await callRoute<PreviewResponse>(POST, {
            method: 'POST',
            headers: bearerHeader(org.admin.accessToken),
            body: { tier: 'pro', period: 'monthly', seat_count: 15 },
          })
        ).status,
      ).toBe(400);

      expect(
        (
          await callRoute<PreviewResponse>(POST, {
            method: 'POST',
            body: {
              organization_id: org.organizationId,
              tier: 'pro',
              period: 'monthly',
              seat_count: 15,
            },
          })
        ).status,
      ).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it('surfaces a subscription it cannot classify instead of quoting a guess', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      retrieveMock.mockResolvedValue({
        id: 'sub_live',
        items: { data: [{ id: 'si_mystery', quantity: 1, price: { lookup_key: 'legacy_thing' } }] },
      } as unknown as Stripe.Subscription);

      const res = await preview(org.admin.accessToken, org.organizationId, {
        tier: 'pro',
        period: 'monthly',
        seat_count: 15,
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/no plan line/i);
      expect(previewMock).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });
});
