import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformAlertInput } from '@/lib/monitoring/platformAlert';

// Only the outbound edges are replaced: the two Stripe reads and the alert sink.
// importOriginal keeps every other export real, so the mock cannot drift out of
// date when a sibling function is added to either module.
const { retrieveSubscription, listCustomerSubscriptions, recordPlatformAlert } = vi.hoisted(() => ({
  retrieveSubscription: vi.fn<(id: string) => Promise<Stripe.Subscription>>(),
  listCustomerSubscriptions: vi.fn<(customerId: string) => Promise<Stripe.Subscription[]>>(),
  recordPlatformAlert:
    vi.fn<(supabase: SupabaseClient, input: PlatformAlertInput) => Promise<void>>(async () => {}),
}));

vi.mock('@/lib/stripe/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe/billing')>()),
  retrieveSubscription,
  listCustomerSubscriptions,
}));

vi.mock('@/lib/monitoring/platformAlert', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/platformAlert')>()),
  recordPlatformAlert,
}));

import { reconcileBillingMirror } from './reconcile';

interface OrgRow {
  id: string;
  subscription_id: string | null;
  subscription_status: string | null;
  plan_tier: string | null;
  billing_period: string | null;
  seat_count: number | null;
}

interface OrphanRow extends OrgRow {
  stripe_customer_id: string | null;
}

/** Growth billed monthly with no extra-seat line, which is exactly 8 included seats. */
function growthMonthly(id: string, extraSeats = 0, status = 'active'): Stripe.Subscription {
  const items = [{ price: { lookup_key: 'growth_monthly' }, quantity: 1 }];
  if (extraSeats > 0) {
    items.push({ price: { lookup_key: 'extra_seat_monthly' }, quantity: extraSeats });
  }
  return { id, status, items: { data: items } } as unknown as Stripe.Subscription;
}

const mirroredGrowthOrg = (overrides: Partial<OrgRow> = {}): OrgRow => ({
  id: 'org-1',
  subscription_id: 'sub_1',
  subscription_status: 'active',
  plan_tier: 'growth',
  billing_period: 'monthly',
  seat_count: 8,
  ...overrides,
});

/** An org that reached Checkout: it has a billing Customer and no subscription id. */
const orphanOrg = (overrides: Partial<OrphanRow> = {}): OrphanRow => ({
  id: 'org-orphan',
  subscription_id: null,
  subscription_status: 'trialing',
  plan_tier: null,
  billing_period: null,
  seat_count: null,
  stripe_customer_id: 'cus_orphan',
  ...overrides,
});

interface StubOptions {
  paying?: OrgRow[];
  orphans?: OrphanRow[];
  selectError?: { message: string };
  orphanSelectError?: { message: string };
  updateError?: { message: string };
}

/**
 * Records the candidate filters and every update, so both can be asserted. The
 * two passes are told apart by the column list: only the orphan pass selects
 * stripe_customer_id.
 */
function stubDb(opts: StubOptions = {}) {
  const filters: Array<[string, ...unknown[]]> = [];
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];

  const makeChain = (isOrphanPass: boolean) => {
    const chain: Record<string, unknown> = {};
    const step = (name: string) => (...args: unknown[]) => {
      filters.push([name, ...args]);
      return chain;
    };
    chain.not = step('not');
    chain.in = step('in');
    chain.is = step('is');
    chain.limit = async (n: number) => {
      filters.push(['limit', n]);
      const error = isOrphanPass ? opts.orphanSelectError : opts.selectError;
      if (error) return { data: null, error };
      return { data: isOrphanPass ? opts.orphans ?? [] : opts.paying ?? [], error: null };
    };
    return chain;
  };

  const from = vi.fn((table: string) => {
    if (table !== 'organizations') throw new Error(`unexpected table ${table}`);
    return {
      select: (columns: string) => {
        filters.push(['select', columns]);
        return makeChain(columns.includes('stripe_customer_id'));
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          updates.push({ id, values });
          return { error: opts.updateError ?? null };
        },
      }),
    };
  });

  return { client: { from } as never, filters, updates };
}

const alertTypes = () => recordPlatformAlert.mock.calls.map((call) => call[1].alert_type);

describe('reconcileBillingMirror drift pass', () => {
  beforeEach(() => {
    retrieveSubscription.mockReset();
    listCustomerSubscriptions.mockReset().mockResolvedValue([]);
    recordPlatformAlert.mockClear();
  });

  it('leaves an org that already matches Stripe alone, and still counts it as checked', async () => {
    const db = stubDb({ paying: [mirroredGrowthOrg()] });
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1'));

    const result = await reconcileBillingMirror(db.client);

    expect(result).toMatchObject({ checked: 1, repaired: 0, failed: 0, details: [] });
    expect(db.updates).toEqual([]);
    expect(recordPlatformAlert).not.toHaveBeenCalled();
  });

  it('repairs a drifted seat_count and alerts, because a silent repair hides a dead webhook', async () => {
    const db = stubDb({ paying: [mirroredGrowthOrg({ seat_count: 8 })] });
    // Three extra seats bought at Stripe; the webhook never landed.
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1', 3));

    const result = await reconcileBillingMirror(db.client);

    expect(result.checked).toBe(1);
    expect(result.repaired).toBe(1);
    expect(result.failed).toBe(0);
    // Only the drifted column is written; the matching ones are left out entirely.
    expect(db.updates).toEqual([{ id: 'org-1', values: { seat_count: 11 } }]);
    expect(result.details[0]).toEqual({
      organizationId: 'org-1',
      subscriptionId: 'sub_1',
      changed: { seat_count: [8, 11] },
    });

    expect(recordPlatformAlert).toHaveBeenCalledTimes(1);
    const alert = recordPlatformAlert.mock.calls[0][1];
    expect(alert.alert_type).toBe('billing_mirror_drift_repaired');
    // platform_alerts has no organization_id column, so the org id rides in details.
    expect(alert.details).toMatchObject({ organization_id: 'org-1', subscription_id: 'sub_1' });
  });

  it('repairs a status Stripe has already moved on from', async () => {
    const db = stubDb({ paying: [mirroredGrowthOrg({ subscription_status: 'active' })] });
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1', 0, 'past_due'));

    const result = await reconcileBillingMirror(db.client);

    expect(result.repaired).toBe(1);
    expect(db.updates).toEqual([{ id: 'org-1', values: { subscription_status: 'past_due' } }]);
  });

  it('never writes plan columns for a subscription whose items are not ours', async () => {
    const db = stubDb({ paying: [mirroredGrowthOrg()] });
    retrieveSubscription.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      items: { data: [{ price: { lookup_key: 'some_other_products_price' }, quantity: 1 }] },
    } as unknown as Stripe.Subscription);

    const result = await reconcileBillingMirror(db.client);

    expect(result.repaired).toBe(0);
    expect(db.updates).toEqual([]);
  });

  it('asks Stripe only about orgs that have a subscription and a paying status', async () => {
    const db = stubDb();

    await reconcileBillingMirror(db.client);

    expect(db.filters).toContainEqual(['not', 'subscription_id', 'is', null]);
    // The three live statuses come from LIVE_SUBSCRIPTION_STATUSES, not a second copy.
    expect(db.filters).toContainEqual(['in', 'subscription_status', ['active', 'past_due', 'unpaid']]);
    // A trialing or comped org has nothing at Stripe to compare against, so no call is made.
    expect(retrieveSubscription).not.toHaveBeenCalled();
  });

  it('keeps sweeping the other orgs when one org errors at Stripe', async () => {
    const db = stubDb({
      paying: [
        mirroredGrowthOrg({ id: 'org-broken', subscription_id: 'sub_broken' }),
        mirroredGrowthOrg({ id: 'org-2', subscription_id: 'sub_2', seat_count: 8 }),
      ],
    });
    retrieveSubscription.mockImplementation(async (id: string) => {
      if (id === 'sub_broken') throw new Error('No such subscription: sub_broken');
      return growthMonthly('sub_2', 2);
    });

    const result = await reconcileBillingMirror(db.client);

    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);
    // The org AFTER the failure was still checked and still repaired.
    expect(result.repaired).toBe(1);
    expect(db.updates).toEqual([{ id: 'org-2', values: { seat_count: 10 } }]);
    expect(result.details).toContainEqual({
      organizationId: 'org-broken',
      subscriptionId: 'sub_broken',
      error: 'No such subscription: sub_broken',
    });

    expect(alertTypes()).toContain('billing_mirror_drift_repaired');
    // pg_cron discards the response, so the unreadable org has to alert on its own.
    expect(alertTypes()).toContain('billing_mirror_reconcile_failed');
  });

  it('counts a failed write as failed rather than reporting a repair that did not happen', async () => {
    const db = stubDb({
      paying: [mirroredGrowthOrg({ seat_count: 5 })],
      updateError: { message: 'deadlock detected' },
    });
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1'));

    const result = await reconcileBillingMirror(db.client);

    expect(result.repaired).toBe(0);
    expect(result.failed).toBe(1);
    expect(alertTypes()).not.toContain('billing_mirror_drift_repaired');
  });

  it('reports a clean zero sweep and touches Stripe not at all when both selects fail', async () => {
    const db = stubDb({
      selectError: { message: 'connection reset' },
      orphanSelectError: { message: 'connection reset' },
    });

    const result = await reconcileBillingMirror(db.client);

    expect(result).toEqual({
      checked: 0,
      repaired: 0,
      orphansChecked: 0,
      adopted: 0,
      failed: 0,
      details: [],
    });
    expect(retrieveSubscription).not.toHaveBeenCalled();
    expect(listCustomerSubscriptions).not.toHaveBeenCalled();
  });
});

// Spec §17, "Checkout completed but webhook late": the customer pays,
// customer.subscription.created never arrives, and the org keeps
// subscription_id null with status trialing. The drift pass cannot see that org
// by construction, so it is the one case that most needs a backstop.
describe('reconcileBillingMirror orphan pass', () => {
  beforeEach(() => {
    retrieveSubscription.mockReset();
    listCustomerSubscriptions.mockReset().mockResolvedValue([]);
    recordPlatformAlert.mockClear();
  });

  it('looks up every org that has a billing Customer but no subscription id', async () => {
    const db = stubDb({ orphans: [orphanOrg()] });

    await reconcileBillingMirror(db.client);

    expect(db.filters).toContainEqual(['not', 'stripe_customer_id', 'is', null]);
    expect(db.filters).toContainEqual(['is', 'subscription_id', null]);
    expect(listCustomerSubscriptions).toHaveBeenCalledWith('cus_orphan');
  });

  it('adopts the subscription a paid-but-unmirrored org is actually on, and alerts loudly', async () => {
    const db = stubDb({ orphans: [orphanOrg()] });
    listCustomerSubscriptions.mockResolvedValue([growthMonthly('sub_paid', 2, 'active')]);

    const result = await reconcileBillingMirror(db.client);

    expect(result.orphansChecked).toBe(1);
    expect(result.adopted).toBe(1);
    expect(result.failed).toBe(0);
    // The id AND the full mirror, by the same rules the drift pass uses.
    expect(db.updates).toEqual([
      {
        id: 'org-orphan',
        values: {
          subscription_id: 'sub_paid',
          subscription_status: 'active',
          plan_tier: 'growth',
          billing_period: 'monthly',
          seat_count: 10,
        },
      },
    ]);
    expect(result.details).toContainEqual({
      organizationId: 'org-orphan',
      subscriptionId: 'sub_paid',
      adopted: true,
      changed: {
        subscription_id: [null, 'sub_paid'],
        subscription_status: ['trialing', 'active'],
        plan_tier: [null, 'growth'],
        billing_period: [null, 'monthly'],
        seat_count: [null, 10],
      },
    });

    expect(recordPlatformAlert).toHaveBeenCalledTimes(1);
    const alert = recordPlatformAlert.mock.calls[0][1];
    expect(alert.alert_type).toBe('billing_subscription_adopted');
    expect(alert.severity).toBe('critical');
    expect(alert.details).toMatchObject({
      organization_id: 'org-orphan',
      subscription_id: 'sub_paid',
      customer_id: 'cus_orphan',
    });
  });

  it('does nothing and does not alert when Stripe has no subscription for that customer', async () => {
    const db = stubDb({ orphans: [orphanOrg()] });
    listCustomerSubscriptions.mockResolvedValue([]);

    const result = await reconcileBillingMirror(db.client);

    expect(result.orphansChecked).toBe(1);
    expect(result.adopted).toBe(0);
    expect(result.failed).toBe(0);
    // An org that opened checkout and never finished is ordinary, not an incident.
    expect(db.updates).toEqual([]);
    expect(recordPlatformAlert).not.toHaveBeenCalled();
  });

  it('never adopts a terminal subscription, which would point the org at a dead row', async () => {
    const db = stubDb({ orphans: [orphanOrg()] });
    listCustomerSubscriptions.mockResolvedValue([
      growthMonthly('sub_expired', 0, 'incomplete_expired'),
      growthMonthly('sub_old', 0, 'canceled'),
    ]);

    const result = await reconcileBillingMirror(db.client);

    expect(result.adopted).toBe(0);
    expect(db.updates).toEqual([]);
    expect(recordPlatformAlert).not.toHaveBeenCalled();
  });

  it('takes the newest non-terminal subscription when a dead one is listed first', async () => {
    const db = stubDb({ orphans: [orphanOrg()] });
    // Stripe lists newest created first.
    listCustomerSubscriptions.mockResolvedValue([
      growthMonthly('sub_dead', 0, 'canceled'),
      growthMonthly('sub_live', 0, 'active'),
    ]);

    const result = await reconcileBillingMirror(db.client);

    expect(result.adopted).toBe(1);
    expect(db.updates[0].values.subscription_id).toBe('sub_live');
  });

  it('keeps sweeping when one orphan errors at Stripe', async () => {
    const db = stubDb({
      orphans: [
        orphanOrg({ id: 'org-broken', stripe_customer_id: 'cus_broken' }),
        orphanOrg({ id: 'org-ok', stripe_customer_id: 'cus_ok' }),
      ],
    });
    listCustomerSubscriptions.mockImplementation(async (customerId: string) => {
      if (customerId === 'cus_broken') throw new Error('No such customer: cus_broken');
      return [growthMonthly('sub_ok', 0, 'active')];
    });

    const result = await reconcileBillingMirror(db.client);

    expect(result.orphansChecked).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.adopted).toBe(1);
    expect(alertTypes()).toContain('billing_subscription_adopted');
    expect(alertTypes()).toContain('billing_mirror_reconcile_failed');
  });

  it('runs both passes in one sweep', async () => {
    const db = stubDb({
      paying: [mirroredGrowthOrg({ seat_count: 8 })],
      orphans: [orphanOrg()],
    });
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1', 1));
    listCustomerSubscriptions.mockResolvedValue([growthMonthly('sub_paid', 0, 'active')]);

    const result = await reconcileBillingMirror(db.client);

    expect(result).toMatchObject({ checked: 1, repaired: 1, orphansChecked: 1, adopted: 1, failed: 0 });
    expect(alertTypes()).toEqual(['billing_mirror_drift_repaired', 'billing_subscription_adopted']);
  });
});
