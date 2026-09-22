// Is a plan change an upgrade, a downgrade, or neither, and does Stripe have to
// invoice it NOW?
//
// Lifted out of POST /api/billing/plan unchanged so POST /api/billing/plan/preview
// can quote the same change the apply call performs (ruling R23). Two copies of
// "is this an upgrade" that can drift is exactly how a preview comes to quote a
// number the apply call does not honour.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §10.4.

import { PLAN_TIERS, planChargeCents, type BillingPeriod, type PlanTier } from './plans';

/** The plan columns as they are stored on `organizations`, which may be null or junk. */
export interface StoredPlan {
  planTier: string | null;
  billingPeriod: string | null;
  seatCount: number | null;
}

/** The plan the operator asked for, already validated by parsePlanSelection. */
export interface PlanChangeTarget {
  tier: PlanTier;
  period: BillingPeriod;
  seatCount: number;
}

/**
 * Three words where shouldInvoiceNow needs one boolean. The UI splits its money
 * copy on this (ruling R21): an upgrade says "Charged today", a downgrade says
 * "Credited to your next invoice", a same-price change says neither.
 */
export type PlanChangeDirection = 'upgrade' | 'downgrade' | 'unchanged';

/** What the stored plan charges per cycle, or null when we cannot read it. */
function storedChargeCents(stored: StoredPlan): number | null {
  const tier = stored.planTier as PlanTier | null;
  const period = stored.billingPeriod as BillingPeriod | null;
  const seats = stored.seatCount;

  const readable =
    tier != null &&
    PLAN_TIERS.includes(tier) &&
    (period === 'monthly' || period === 'annual') &&
    typeof seats === 'number' &&
    Number.isFinite(seats);
  if (!readable) return null;

  return planChargeCents(tier, period, seats);
}

/**
 * Which way the money moves.
 *
 * One comparison of what Stripe charges per cycle reproduces the whole policy
 * table:
 *
 *   | change                              | charge moves | direction |
 *   | tier or seats UP                    | up           | upgrade   |
 *   | tier or seats DOWN                  | down         | downgrade |
 *   | monthly to annual (buying a year)   | up           | upgrade   |
 *   | annual to monthly                   | down         | downgrade |
 *   | same charge (a seat shuffle)        | flat         | unchanged |
 *
 * A stored plan we cannot read is treated as an upgrade, which fails toward
 * charging rather than toward giving away service.
 */
export function directionOf(stored: StoredPlan, target: PlanChangeTarget): PlanChangeDirection {
  const currentCents = storedChargeCents(stored);
  if (currentCents == null) return 'upgrade';

  const targetCents = planChargeCents(target.tier, target.period, target.seatCount);
  if (targetCents > currentCents) return 'upgrade';
  if (targetCents === currentCents) return 'unchanged';
  return 'downgrade';
}

/**
 * Does this change have to be invoiced NOW, or does it ride the next invoice?
 *
 * Anything that raises the charge is billed immediately, because
 * `create_prorations` writes the proration lines without invoicing them: the
 * money would otherwise wait for the next scheduled invoice, which on an annual
 * plan is up to a year away. Anything that lowers it is left as a credit on the
 * next invoice; we never refund cash for a downgrade.
 */
export function shouldInvoiceNow(stored: StoredPlan, target: PlanChangeTarget): boolean {
  return directionOf(stored, target) === 'upgrade';
}
