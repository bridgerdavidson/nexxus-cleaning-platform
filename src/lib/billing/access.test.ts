import { describe, expect, it } from 'vitest';
import { deriveBillingAccess, type OrgBillingRow } from './access';

const NOW = new Date('2026-09-13T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const row = (over: Partial<OrgBillingRow> = {}): OrgBillingRow => ({
  subscription_status: 'trialing',
  trial_ends_at: days(7),
  trial_extended_at: null,
  comped_at: null,
  plan_tier: null,
  billing_period: null,
  seat_count: null,
  subscription_cancel_at: null,
  billing_paused_at: null,
  billing_pause_resumes_at: null,
  ...over,
});

describe('deriveBillingAccess precedence', () => {
  it('puts comped above everything, including a canceled subscription', () => {
    const a = deriveBillingAccess(row({ comped_at: days(-30), subscription_status: 'canceled' }), NOW);
    expect(a.state).toBe('comped');
    expect(a.frozen).toBe(false);
    expect(a.seatCap).toBeNull();
  });

  it('keeps a comped org unfrozen even with a long-expired trial', () => {
    const a = deriveBillingAccess(row({ comped_at: days(-90), trial_ends_at: days(-60) }), NOW);
    expect(a.state).toBe('comped');
    expect(a.frozen).toBe(false);
  });

  it('puts paused above the Stripe status', () => {
    const a = deriveBillingAccess(row({ subscription_status: 'active', billing_paused_at: days(-2) }), NOW);
    expect(a.state).toBe('paused');
    expect(a.frozen).toBe(true);
  });

  it('lets comped win over paused', () => {
    const a = deriveBillingAccess(row({ comped_at: days(-1), billing_paused_at: days(-2) }), NOW);
    expect(a.state).toBe('comped');
    expect(a.frozen).toBe(false);
  });
});

describe('deriveBillingAccess trial clock', () => {
  it('is trialing while the clock runs', () => {
    const a = deriveBillingAccess(row({ trial_ends_at: days(7) }), NOW);
    expect(a.state).toBe('trialing');
    expect(a.frozen).toBe(false);
    expect(a.trialDaysLeft).toBe(7);
    expect(a.seatCap).toBe(15);
  });

  it('is still trialing in the final second', () => {
    const a = deriveBillingAccess(
      row({ trial_ends_at: new Date(NOW.getTime() + 1000).toISOString() }),
      NOW,
    );
    expect(a.state).toBe('trialing');
    expect(a.trialDaysLeft).toBe(1);
  });

  it('freezes the moment the clock passes', () => {
    const a = deriveBillingAccess(
      row({ trial_ends_at: new Date(NOW.getTime() - 1000).toISOString() }),
      NOW,
    );
    expect(a.state).toBe('trial_expired');
    expect(a.frozen).toBe(true);
    expect(a.trialDaysLeft).toBe(0);
  });

  it('rounds partial days up, so "0 days left" never shows on a live trial', () => {
    const a = deriveBillingAccess(
      row({ trial_ends_at: new Date(NOW.getTime() + 3 * 3_600_000).toISOString() }),
      NOW,
    );
    expect(a.trialDaysLeft).toBe(1);
  });

  it('offers the extension once and then never again', () => {
    expect(deriveBillingAccess(row({ trial_ends_at: days(2) }), NOW).canExtendTrial).toBe(true);
    expect(deriveBillingAccess(row({ trial_ends_at: days(-2) }), NOW).canExtendTrial).toBe(true);
    expect(
      deriveBillingAccess(row({ trial_ends_at: days(2), trial_extended_at: days(-1) }), NOW).canExtendTrial,
    ).toBe(false);
  });

  it('does not offer an extension to a paying or comped org', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'active' }), NOW).canExtendTrial).toBe(false);
    expect(deriveBillingAccess(row({ comped_at: days(-1) }), NOW).canExtendTrial).toBe(false);
  });

  it('treats a trialing row with no end date as expired', () => {
    const a = deriveBillingAccess(row({ trial_ends_at: null }), NOW);
    expect(a.state).toBe('trial_expired');
    expect(a.frozen).toBe(true);
  });
});

describe('deriveBillingAccess Stripe statuses', () => {
  it.each([
    ['active',   'active',        false],
    ['past_due', 'past_due',      false],
    ['unpaid',   'unpaid',        true],
    ['canceled', 'canceled',      true],
  ] as const)('maps %s to %s (frozen: %s)', (status, state, frozen) => {
    const a = deriveBillingAccess(row({ subscription_status: status, seat_count: 8 }), NOW);
    expect(a.state).toBe(state);
    expect(a.frozen).toBe(frozen);
  });

  it('fails closed on `none` even when the trial clock is still live', () => {
    // The default row has a trial 7 days out. `none` must still freeze: it is an
    // impossible state after the backfill, and free service is the worse error.
    const a = deriveBillingAccess(row({ subscription_status: 'none' }), NOW);
    expect(a.state).toBe('trial_expired');
    expect(a.frozen).toBe(true);
  });

  it('keeps past_due unfrozen because Stripe is still retrying', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'past_due' }), NOW).frozen).toBe(false);
  });
});

describe('deriveBillingAccess seat cap', () => {
  it('is unlimited when comped', () => {
    expect(deriveBillingAccess(row({ comped_at: days(-1) }), NOW).seatCap).toBeNull();
  });

  it('is the flat trial cap during and after a trial', () => {
    expect(deriveBillingAccess(row({ trial_ends_at: days(3) }), NOW).seatCap).toBe(15);
    expect(deriveBillingAccess(row({ trial_ends_at: days(-3) }), NOW).seatCap).toBe(15);
  });

  it('is what they purchased once they are paying', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'active', seat_count: 12 }), NOW).seatCap).toBe(12);
  });

  it('falls back to the trial cap when a paying org has no seat count yet', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'active', seat_count: null }), NOW).seatCap).toBe(15);
  });
});

describe('deriveBillingAccess after an un-comp', () => {
  it('lands in an open trial, never frozen', () => {
    // The exact row shape the back office writes: comp cleared, runway stamped.
    const a = deriveBillingAccess(
      row({ comped_at: null, subscription_status: 'trialing', trial_ends_at: days(14) }),
      NOW,
    );
    expect(a.state).toBe('trialing');
    expect(a.frozen).toBe(false);
  });
});
