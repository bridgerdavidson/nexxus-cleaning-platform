import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformAlertInput } from '@/lib/monitoring/platformAlert';

// Only the two outbound edges are replaced: the Stripe read and the alert sink.
// importOriginal keeps every other export real, so the mock cannot drift out of
// date when a sibling function is added to either module.
const { retrieveSubscription, recordPlatformAlert } = vi.hoisted(() => ({
  retrieveSubscription: vi.fn<(id: string) => Promise<Stripe.Subscription>>(),
  recordPlatformAlert:
    vi.fn<(supabase: SupabaseClient, input: PlatformAlertInput) => Promise<void>>(async () => {}),
}));

vi.mock('@/lib/stripe/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe/billing')>()),
  retrieveSubscription,
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

/** Records the candidate filters and every update, so both can be asserted. */
function stubDb(rows: OrgRow[], opts: { selectError?: { message: string }; updateError?: { message: string } } = {}) {
  const filters: Array<[string, ...unknown[]]> = [];
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];

  const selectChain: Record<string, unknown> = {};
  selectChain.not = (...args: unknown[]) => { filters.push(['not', ...args]); return selectChain; };
  selectChain.in = (...args: unknown[]) => { filters.push(['in', ...args]); return selectChain; };
  selectChain.limit = async (n: number) => {
    filters.push(['limit', n]);
    return opts.selectError ? { data: null, error: opts.selectError } : { data: rows, error: null };
  };

  const from = vi.fn((table: string) => {
    if (table !== 'organizations') throw new Error(`unexpected table ${table}`);
    return {
      select: (columns: string) => { filters.push(['select', columns]); return selectChain; },
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

describe('reconcileBillingMirror', () => {
  beforeEach(() => {
    retrieveSubscription.mockReset();
    recordPlatformAlert.mockClear();
  });

  it('leaves an org that already matches Stripe alone, and still counts it as checked', async () => {
    const db = stubDb([mirroredGrowthOrg()]);
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1'));

    const result = await reconcileBillingMirror(db.client);

    expect(result).toMatchObject({ checked: 1, repaired: 0, failed: 0, details: [] });
    expect(db.updates).toEqual([]);
    expect(recordPlatformAlert).not.toHaveBeenCalled();
  });

  it('repairs a drifted seat_count and alerts, because a silent repair hides a dead webhook', async () => {
    const db = stubDb([mirroredGrowthOrg({ seat_count: 8 })]);
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
    const db = stubDb([mirroredGrowthOrg({ subscription_status: 'active' })]);
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1', 0, 'past_due'));

    const result = await reconcileBillingMirror(db.client);

    expect(result.repaired).toBe(1);
    expect(db.updates).toEqual([{ id: 'org-1', values: { subscription_status: 'past_due' } }]);
  });

  it('never writes plan columns for a subscription whose items are not ours', async () => {
    const db = stubDb([mirroredGrowthOrg()]);
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
    const db = stubDb([]);

    await reconcileBillingMirror(db.client);

    expect(db.filters).toContainEqual(['not', 'subscription_id', 'is', null]);
    expect(db.filters).toContainEqual(['in', 'subscription_status', ['active', 'past_due', 'unpaid']]);
    // A trialing or comped org has nothing at Stripe to compare against, so no call is made.
    expect(retrieveSubscription).not.toHaveBeenCalled();
  });

  it('keeps sweeping the other orgs when one org errors at Stripe', async () => {
    const db = stubDb([
      mirroredGrowthOrg({ id: 'org-broken', subscription_id: 'sub_broken' }),
      mirroredGrowthOrg({ id: 'org-2', subscription_id: 'sub_2', seat_count: 8 }),
    ]);
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

    const types = recordPlatformAlert.mock.calls.map((call) => call[1].alert_type);
    expect(types).toContain('billing_mirror_drift_repaired');
    // pg_cron discards the response, so the unreadable org has to alert on its own.
    expect(types).toContain('billing_mirror_reconcile_failed');
  });

  it('counts a failed write as failed rather than reporting a repair that did not happen', async () => {
    const db = stubDb([mirroredGrowthOrg({ seat_count: 5 })], { updateError: { message: 'deadlock detected' } });
    retrieveSubscription.mockResolvedValue(growthMonthly('sub_1'));

    const result = await reconcileBillingMirror(db.client);

    expect(result.repaired).toBe(0);
    expect(result.failed).toBe(1);
    expect(recordPlatformAlert).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ alert_type: 'billing_mirror_drift_repaired' }),
    );
  });

  it('reports a clean zero sweep and touches Stripe not at all when the candidate select fails', async () => {
    const db = stubDb([], { selectError: { message: 'connection reset' } });

    const result = await reconcileBillingMirror(db.client);

    expect(result).toEqual({ checked: 0, repaired: 0, failed: 0, details: [] });
    expect(retrieveSubscription).not.toHaveBeenCalled();
  });
});
