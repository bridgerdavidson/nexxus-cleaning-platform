import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// The Stripe wrappers are mocked so the orchestration can be asserted without a
// Stripe account. What goes INTO Stripe (behavior 'void', the empty-string
// resume, cancel_at_period_end) is pinned one layer down in
// src/lib/stripe/billing.test.ts, which is the only place that sees the real
// parameters.
// vi.hoisted, because vi.mock's factory is lifted above every top-level const.
const {
  pauseSubscription,
  resumeSubscription,
  cancelSubscriptionAtPeriodEnd,
  cancelStripeSubscription,
  createBillingPortalSession,
  resolvePortalConfiguration,
} = vi.hoisted(() => ({
  pauseSubscription: vi.fn(async () => ({ id: 'sub_live', status: 'active' })),
  resumeSubscription: vi.fn(async () => ({ id: 'sub_live', status: 'active' })),
  cancelSubscriptionAtPeriodEnd: vi.fn(async () => ({ id: 'sub_live', status: 'active' })),
  cancelStripeSubscription: vi.fn(async () => ({ id: 'sub_live', status: 'canceled' })),
  createBillingPortalSession: vi.fn(async () => ({ url: 'https://billing.stripe.test/session' })),
  resolvePortalConfiguration: vi.fn(async () => 'bpc_ours'),
}));

vi.mock('@/lib/stripe/billing', () => ({
  createStripeBillingCustomer: vi.fn(),
  createBillingCheckoutSession: vi.fn(),
  resolvePrices: vi.fn(),
  createBillingPortalSession,
  resolvePortalConfiguration,
  pauseSubscription,
  resumeSubscription,
  cancelSubscriptionAtPeriodEnd,
  cancelStripeSubscription,
}));

import {
  cancelOrgSubscription,
  getOrgPortalLink,
  mapSubscriptionStatus,
  pauseOrgBilling,
  resumeOrgBilling,
} from './orgBilling';

describe('mapSubscriptionStatus', () => {
  it('passes through the directly-allowed statuses', () => {
    expect(mapSubscriptionStatus('trialing')).toBe('trialing');
    expect(mapSubscriptionStatus('active')).toBe('active');
    expect(mapSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapSubscriptionStatus('canceled')).toBe('canceled');
  });

  it('keeps unpaid its own status (retries exhausted, org freezes)', () => {
    expect(mapSubscriptionStatus('unpaid')).toBe('unpaid');
  });

  it('maps incomplete_expired → canceled (terminal)', () => {
    expect(mapSubscriptionStatus('incomplete_expired')).toBe('canceled');
  });

  it('maps not-yet-active / unknown states to none', () => {
    expect(mapSubscriptionStatus('incomplete')).toBe('none');
    expect(mapSubscriptionStatus('paused')).toBe('none');
    expect(mapSubscriptionStatus('something_new')).toBe('none');
    expect(mapSubscriptionStatus(null)).toBe('none');
    expect(mapSubscriptionStatus(undefined)).toBe('none');
  });

  it('only ever returns a status the organizations check constraint allows', () => {
    const allowed = new Set(['none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled']);
    for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'weird', null, undefined]) {
      expect(allowed.has(mapSubscriptionStatus(s))).toBe(true);
    }
  });
});

describe('mapSubscriptionStatus unpaid', () => {
  it('keeps unpaid distinct from past_due', () => {
    expect(mapSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapSubscriptionStatus('unpaid')).toBe('unpaid');
  });

  it('still collapses the states that have no row value', () => {
    expect(mapSubscriptionStatus('incomplete')).toBe('none');
    expect(mapSubscriptionStatus('paused')).toBe('none');
    expect(mapSubscriptionStatus(null)).toBe('none');
    expect(mapSubscriptionStatus('something_new')).toBe('none');
  });

  it('still maps the terminal states to canceled', () => {
    expect(mapSubscriptionStatus('canceled')).toBe('canceled');
    expect(mapSubscriptionStatus('incomplete_expired')).toBe('canceled');
  });
});

// ---------------------------------------------------------------------------
// Pause / resume / cancel orchestration (Task 18)
// ---------------------------------------------------------------------------

interface FakeWrite {
  table: string;
  row: Record<string, unknown>;
}

/**
 * Minimal stand-in for the two shapes orgBilling uses: the org read
 * (.select().eq().maybeSingle()) and the audit insert. Every write is recorded
 * so a test can assert what was NOT written as easily as what was.
 */
function fakeSupabase(orgRow: Record<string, unknown> | null) {
  const inserts: FakeWrite[] = [];
  const updates: FakeWrite[] = [];
  const client = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: orgRow, error: null }) }),
        }),
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { error: null };
        },
        update: (row: Record<string, unknown>) => {
          updates.push({ table, row });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { supabase: client as unknown as SupabaseClient, inserts, updates };
}

const liveOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Acme Cleaning',
  billing_email: null,
  stripe_customer_id: 'cus_1',
  subscription_id: 'sub_live',
  subscription_status: 'active',
  ...overrides,
});

const auditRows = (inserts: FakeWrite[]) =>
  inserts.filter((w) => w.table === 'tenant_subscription_events').map((w) => w.row);

beforeEach(() => {
  pauseSubscription.mockClear();
  resumeSubscription.mockClear();
  cancelSubscriptionAtPeriodEnd.mockClear();
  cancelStripeSubscription.mockClear();
  createBillingPortalSession.mockClear();
  resolvePortalConfiguration.mockClear();
});

describe('getOrgPortalLink', () => {
  // The portal configuration is what disables plan changes inside the portal
  // (they belong in the app) and enables the cancellation-reason survey. A
  // session created without it silently uses the Stripe account default, which
  // enforces neither, and no UI calls this route yet to notice.
  it('creates the session against our portal configuration', async () => {
    const { supabase } = fakeSupabase(liveOrg());

    const url = await getOrgPortalLink(supabase, 'org-1', 'https://app.test/admin', 'owner');

    expect(url).toBe('https://billing.stripe.test/session');
    expect(resolvePortalConfiguration).toHaveBeenCalledTimes(1);
    expect(createBillingPortalSession).toHaveBeenCalledWith({
      customerId: 'cus_1',
      returnUrl: 'https://app.test/admin',
      configuration: 'bpc_ours',
    });
  });

  // Ruling R24. Mutation target: "always resolve the default configuration".
  // The owner portal can END the agreement; an admin sent there to fix a card
  // would find the Cancel subscription button, which makes the owner-only rule
  // on every purchase control decorative.
  it('sends an owner to the full portal and an admin to the remediation portal', async () => {
    const { supabase } = fakeSupabase(liveOrg());

    await getOrgPortalLink(supabase, 'org-1', 'https://app.test/admin', 'owner');
    expect(resolvePortalConfiguration).toHaveBeenLastCalledWith('default');

    await getOrgPortalLink(supabase, 'org-1', 'https://app.test/admin', 'admin');
    expect(resolvePortalConfiguration).toHaveBeenLastCalledWith('remediation');
  });

  // The route only admits owner and admin, but this function must not depend on
  // that: anything that is not literally the owner gets the portal that cannot
  // cancel. Mutation target: "treat an unrecognized role as the owner".
  it('gives the remediation portal to every role that is not the owner', async () => {
    const { supabase } = fakeSupabase(liveOrg());
    for (const role of ['admin', 'manager', 'cleaner', 'homeowner', '']) {
      resolvePortalConfiguration.mockClear();
      await getOrgPortalLink(supabase, 'org-1', 'https://app.test/admin', role);
      expect(resolvePortalConfiguration, role).toHaveBeenCalledWith('remediation');
    }
  });

  // A half-configured Stripe account should fail loudly, not hand the customer a
  // portal that lets them change plans behind the app's back.
  it('does not open a session at all when no configuration is tagged', async () => {
    resolvePortalConfiguration.mockRejectedValueOnce(
      new Error('No Customer Portal configuration tagged nexxus_portal=default.'),
    );
    const { supabase } = fakeSupabase(liveOrg());

    await expect(
      getOrgPortalLink(supabase, 'org-1', 'https://app.test/admin', 'owner'),
    ).rejects.toThrow(/nexxus_portal=default/);
    expect(createBillingPortalSession).not.toHaveBeenCalled();
  });
});

describe('pauseOrgBilling', () => {
  it('pauses the live subscription with the given resume date as a unix timestamp', async () => {
    const { supabase } = fakeSupabase(liveOrg());
    const resumesAt = new Date('2027-03-01T00:00:00.000Z');
    await pauseOrgBilling(supabase, 'org-1', resumesAt);
    expect(pauseSubscription).toHaveBeenCalledWith('sub_live', Math.floor(resumesAt.getTime() / 1000));
  });

  it('passes null for an open-ended pause', async () => {
    const { supabase } = fakeSupabase(liveOrg());
    await pauseOrgBilling(supabase, 'org-1', null);
    expect(pauseSubscription).toHaveBeenCalledWith('sub_live', null);
  });

  it('writes an app.platform_paused audit row carrying the resume date', async () => {
    const { supabase, inserts } = fakeSupabase(liveOrg());
    await pauseOrgBilling(supabase, 'org-1', new Date('2027-03-01T00:00:00.000Z'));
    const rows = auditRows(inserts);
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe('app.platform_paused');
    expect(rows[0].organization_id).toBe('org-1');
    expect((rows[0].payload as Record<string, unknown>).resumes_at).toBe('2027-03-01T00:00:00.000Z');
  });

  it('refuses an org with no live subscription and calls Stripe not at all', async () => {
    const { supabase } = fakeSupabase(liveOrg({ subscription_status: 'trialing' }));
    await expect(pauseOrgBilling(supabase, 'org-1', null)).rejects.toThrow(/no active subscription/);
    expect(pauseSubscription).not.toHaveBeenCalled();
  });

  it('refuses an org with a status but no subscription id', async () => {
    const { supabase } = fakeSupabase(liveOrg({ subscription_id: null }));
    await expect(pauseOrgBilling(supabase, 'org-1', null)).rejects.toThrow(/no active subscription/);
    expect(pauseSubscription).not.toHaveBeenCalled();
  });

  it('refuses when the organization row does not exist', async () => {
    const { supabase } = fakeSupabase(null);
    await expect(pauseOrgBilling(supabase, 'org-1', null)).rejects.toThrow('organization_not_found');
  });

  it('rejects an invalid resume date rather than sending NaN to Stripe', async () => {
    const { supabase } = fakeSupabase(liveOrg());
    await expect(pauseOrgBilling(supabase, 'org-1', new Date('not a date'))).rejects.toThrow(/valid date/);
    expect(pauseSubscription).not.toHaveBeenCalled();
  });

  it('pauses past_due and unpaid orgs too: Stripe is still billing them', async () => {
    for (const status of ['past_due', 'unpaid']) {
      const { supabase } = fakeSupabase(liveOrg({ subscription_status: status }));
      await pauseOrgBilling(supabase, 'org-1', null);
    }
    expect(pauseSubscription).toHaveBeenCalledTimes(2);
  });
});

describe('resumeOrgBilling', () => {
  it('resumes the live subscription and audits it', async () => {
    const { supabase, inserts } = fakeSupabase(liveOrg());
    await resumeOrgBilling(supabase, 'org-1');
    expect(resumeSubscription).toHaveBeenCalledWith('sub_live');
    const rows = auditRows(inserts);
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe('app.platform_resumed');
  });

  it('refuses an org with no live subscription', async () => {
    const { supabase } = fakeSupabase(liveOrg({ subscription_status: 'canceled' }));
    await expect(resumeOrgBilling(supabase, 'org-1')).rejects.toThrow(/no active subscription/);
    expect(resumeSubscription).not.toHaveBeenCalled();
  });
});

describe('cancelOrgSubscription', () => {
  it("period_end schedules the cancel and never ends the subscription immediately", async () => {
    const { supabase, inserts } = fakeSupabase(liveOrg());
    await cancelOrgSubscription(supabase, 'org-1', 'period_end');
    expect(cancelSubscriptionAtPeriodEnd).toHaveBeenCalledWith('sub_live');
    expect(cancelStripeSubscription).not.toHaveBeenCalled();
    const rows = auditRows(inserts);
    expect(rows[0].event_type).toBe('app.platform_canceled');
    expect((rows[0].payload as Record<string, unknown>).when).toBe('period_end');
  });

  it('now ends the subscription immediately and never merely schedules it', async () => {
    const { supabase, inserts } = fakeSupabase(liveOrg());
    await cancelOrgSubscription(supabase, 'org-1', 'now');
    expect(cancelStripeSubscription).toHaveBeenCalledWith('sub_live');
    expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
    expect((auditRows(inserts)[0].payload as Record<string, unknown>).when).toBe('now');
  });

  it('refuses an org with no live subscription instead of returning silently', async () => {
    const { supabase } = fakeSupabase(liveOrg({ subscription_id: null, subscription_status: 'none' }));
    await expect(cancelOrgSubscription(supabase, 'org-1', 'now')).rejects.toThrow(/no active subscription/);
    expect(cancelStripeSubscription).not.toHaveBeenCalled();
  });
});

describe('none of the three writes the pause columns', () => {
  // The webhook mirrors pause_collection onto billing_paused_at /
  // billing_pause_resumes_at. Writing them here as well would give one fact two
  // sources of truth, and they would disagree the moment Stripe and the app
  // saw different things.
  it('touches no organizations column at all, pause columns included', async () => {
    const cases: Array<() => Promise<{ inserts: FakeWrite[]; updates: FakeWrite[] }>> = [
      async () => {
        const f = fakeSupabase(liveOrg());
        await pauseOrgBilling(f.supabase, 'org-1', new Date('2027-03-01T00:00:00.000Z'));
        return f;
      },
      async () => {
        const f = fakeSupabase(liveOrg());
        await resumeOrgBilling(f.supabase, 'org-1');
        return f;
      },
      async () => {
        const f = fakeSupabase(liveOrg());
        await cancelOrgSubscription(f.supabase, 'org-1', 'period_end');
        return f;
      },
    ];

    for (const run of cases) {
      const { inserts, updates } = await run();
      expect(updates).toEqual([]);
      const written = JSON.stringify([...inserts, ...updates]);
      expect(written).not.toContain('billing_paused_at');
      expect(written).not.toContain('billing_pause_resumes_at');
      expect(written).not.toContain('subscription_status');
    }
  });
});
