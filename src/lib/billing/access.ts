// The one definition of "frozen" in the system. The server guard, the client
// hook, the banner, the paywall, and the back office all call this. Never
// re-derive freezing anywhere else.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §7.

import { TRIAL_SEAT_CAP, type BillingPeriod, type PlanTier } from './plans';

export type BillingState =
  | 'comped'
  | 'paused'
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled';

export type OrgSubscriptionStatus =
  | 'none' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled';

/** The organizations columns billing access is derived from. */
export interface OrgBillingRow {
  subscription_status: OrgSubscriptionStatus | string;
  trial_ends_at: string | null;
  trial_extended_at: string | null;
  comped_at: string | null;
  plan_tier: PlanTier | string | null;
  billing_period: BillingPeriod | string | null;
  seat_count: number | null;
  subscription_cancel_at: string | null;
  billing_paused_at: string | null;
  billing_pause_resumes_at: string | null;
}

/**
 * Every caller selects the same columns. Use this in every `.select()` that
 * feeds deriveBillingAccess so a new column is added in exactly one place.
 */
export const ORG_BILLING_COLUMNS =
  'subscription_status, trial_ends_at, trial_extended_at, comped_at, plan_tier, ' +
  'billing_period, seat_count, subscription_cancel_at, billing_paused_at, billing_pause_resumes_at';

export interface BillingAccess {
  state: BillingState;
  frozen: boolean;
  /** Whole days remaining, rounded up. Null unless trialing or trial_expired. */
  trialDaysLeft: number | null;
  /** True when the one-time self-serve 7-day extension is still available. */
  canExtendTrial: boolean;
  /** Maximum cleaner seats. Null = no limit (comped only). */
  seatCap: number | null;
}

const FROZEN_STATES: ReadonlySet<BillingState> = new Set<BillingState>([
  'paused', 'trial_expired', 'unpaid', 'canceled',
]);

function daysLeft(trialEndsAt: string | null, now: Date): number {
  if (!trialEndsAt) return 0;
  const remaining = new Date(trialEndsAt).getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  // Round up so a trial with three hours left reads "1 day left", never "0".
  return Math.ceil(remaining / 86_400_000);
}

export function deriveBillingAccess(org: OrgBillingRow, now: Date): BillingAccess {
  // Precedence is strict: comp beats everything, then pause, then the trial
  // clock, then whatever Stripe last told us.
  if (org.comped_at) {
    return { state: 'comped', frozen: false, trialDaysLeft: null, canExtendTrial: false, seatCap: null };
  }

  if (org.billing_paused_at) {
    return {
      state: 'paused',
      frozen: true,
      trialDaysLeft: null,
      canExtendTrial: false,
      seatCap: org.seat_count ?? TRIAL_SEAT_CAP,
    };
  }

  // `none` cannot occur after the Phase 1b backfill and the provisioning stamp.
  // If it ever does, fail closed into the paywall regardless of what the trial
  // clock says: the org sees a plan picker rather than silently receiving free
  // service. Spec §7 states this outcome unconditionally.
  if (org.subscription_status === 'none') {
    return {
      state: 'trial_expired',
      frozen: true,
      trialDaysLeft: 0,
      canExtendTrial: org.trial_extended_at == null,
      seatCap: TRIAL_SEAT_CAP,
    };
  }

  const status = org.subscription_status;

  if (status === 'trialing') {
    const left = daysLeft(org.trial_ends_at, now);
    const live = org.trial_ends_at != null && left > 0;
    return {
      state: live ? 'trialing' : 'trial_expired',
      frozen: !live,
      trialDaysLeft: left,
      canExtendTrial: org.trial_extended_at == null,
      seatCap: TRIAL_SEAT_CAP,
    };
  }

  const state: BillingState =
    status === 'active' ? 'active'
    : status === 'past_due' ? 'past_due'
    : status === 'unpaid' ? 'unpaid'
    : 'canceled';

  return {
    state,
    frozen: FROZEN_STATES.has(state),
    trialDaysLeft: null,
    canExtendTrial: false,
    seatCap: org.seat_count ?? TRIAL_SEAT_CAP,
  };
}
