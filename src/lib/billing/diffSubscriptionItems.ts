// Turns "what the subscription has now" plus "what they asked for" into the
// items array for ONE subscriptions.update. Pure, so tier, interval, and seat
// changes are testable without touching Stripe.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §10.4.

import { PLANS, lookupKeyFor, seatLookupKeyFor, type BillingPeriod, type LookupKey, type PlanTier } from './plans';

export interface CurrentSubscriptionItems {
  baseItemId: string;
  basePriceLookupKey: string;
  /** Null when the subscription has no extra-seat line. */
  seatItemId: string | null;
  seatQuantity: number;
}

export interface TargetPlan {
  tier: PlanTier;
  period: BillingPeriod;
  seatCount: number;
}

export type SubscriptionItemUpdate =
  | { id: string; price: string }
  | { id: string; price: string; quantity: number }
  | { price: string; quantity: number }
  | { id: string; deleted: true };

export function diffSubscriptionItems(
  current: CurrentSubscriptionItems,
  target: TargetPlan,
  prices: Record<LookupKey, string>,
): SubscriptionItemUpdate[] {
  const items: SubscriptionItemUpdate[] = [
    { id: current.baseItemId, price: prices[lookupKeyFor(target.tier, target.period)] },
  ];

  const extras = Math.max(0, target.seatCount - PLANS[target.tier].includedSeats);
  const seatPrice = prices[seatLookupKeyFor(target.period)];

  if (extras > 0) {
    // Update the existing seat line, or open one.
    items.push(
      current.seatItemId
        ? { id: current.seatItemId, price: seatPrice, quantity: extras }
        : { price: seatPrice, quantity: extras },
    );
  } else if (current.seatItemId) {
    // Delete rather than set quantity 0, which would leave an empty invoice line.
    items.push({ id: current.seatItemId, deleted: true });
  }

  return items;
}
