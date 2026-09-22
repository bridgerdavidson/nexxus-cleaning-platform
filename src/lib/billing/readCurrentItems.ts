// Classifies a live subscription's line items into the base plan line and the
// extra-seat line, which is what diffSubscriptionItems needs to build an update.
//
// Shared rather than private to POST /api/billing/plan because PR F's preview
// endpoint has to quote the same plan the change applies. Two copies that can
// drift is exactly how a preview comes to show a different tier than the one the
// customer ends up on.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §10.1, §10.4.

import type Stripe from 'stripe';
import type { CurrentSubscriptionItems } from './diffSubscriptionItems';
import {
  LOOKUP_KEYS,
  seatLookupKeyFor,
  tierFor,
  type BillingPeriod,
  type LookupKey,
} from './plans';

const SEAT_LOOKUP_KEYS: string[] = [seatLookupKeyFor('monthly'), seatLookupKeyFor('annual')];

/**
 * The metadata key scripts/stripe-billing-setup.ts stamps on every Price it
 * creates. Unlike `lookup_key`, metadata cannot be transferred away from a Price,
 * so it survives a reprice.
 */
const PRICE_METADATA_KEY = 'nexxus_lookup_key';

/** The metadata key the same script stamps on every Product ('starter', 'growth', 'pro', 'extra_seat'). */
const PRODUCT_METADATA_KEY = 'nexxus_plan';

const isLookupKey = (value: string): value is LookupKey =>
  (LOOKUP_KEYS as readonly string[]).includes(value);

/**
 * Our lookup key for a subscription item's Price, or '' when it is not ours.
 *
 * `lookup_key` alone is NOT enough. Stripe's `transfer_lookup_key: true` moves
 * the key onto a newly created Price, which leaves every existing subscriber
 * billing on a Price that no longer carries one. Classifying by the key alone
 * therefore locks exactly those customers out of changing tier or seats, and
 * silently stops the webhook mirroring what they bought. So fall back, in order:
 *
 *  1. `price.lookup_key`, the fast path and the only one the common case needs;
 *  2. `price.metadata.nexxus_lookup_key`, stamped by the setup script and
 *     unaffected by a lookup-key transfer;
 *  3. the Product's `metadata.nexxus_plan` plus the Price's billing interval,
 *     for a Price created by hand in the Dashboard without our metadata. This
 *     only fires when the caller expanded `price.product`; an unexpanded product
 *     is a bare id string and mapping it back would cost an extra Stripe call
 *     that case 2 already makes unnecessary.
 */
export function lookupKeyForItem(item: Stripe.SubscriptionItem): string {
  const price = item.price as Stripe.Price | undefined;
  if (!price) return '';

  if (price.lookup_key && isLookupKey(price.lookup_key)) return price.lookup_key;

  const fromPrice = price.metadata?.[PRICE_METADATA_KEY];
  if (fromPrice && isLookupKey(fromPrice)) return fromPrice;

  const product = price.product;
  if (product && typeof product === 'object' && !('deleted' in product && product.deleted)) {
    const plan = (product as Stripe.Product).metadata?.[PRODUCT_METADATA_KEY];
    const interval = price.recurring?.interval;
    const period: BillingPeriod | null =
      interval === 'year' ? 'annual' : interval === 'month' ? 'monthly' : null;

    if (plan && period) {
      const composed = plan === 'extra_seat' ? seatLookupKeyFor(period) : `${plan}_${period}`;
      if (isLookupKey(composed)) return composed;
    }
  }

  return '';
}

/**
 * Split a subscription into the base plan line and the extra-seat line.
 *
 * `items.data[].price` rides along on a plain retrieve, so this needs no extra
 * fetch. Throws rather than guessing when no base line is ours: diffing a
 * subscription this system did not create would quietly replace a price we do
 * not understand.
 */
export function readCurrentItems(sub: Stripe.Subscription): CurrentSubscriptionItems {
  let baseItemId: string | null = null;
  let basePriceLookupKey = '';
  let seatItemId: string | null = null;
  let seatQuantity = 0;

  for (const item of sub.items?.data ?? []) {
    const lookupKey = lookupKeyForItem(item);
    if (tierFor(lookupKey)) {
      baseItemId = item.id;
      basePriceLookupKey = lookupKey;
    } else if (SEAT_LOOKUP_KEYS.includes(lookupKey)) {
      seatItemId = item.id;
      seatQuantity = item.quantity ?? 0;
    }
  }

  if (!baseItemId) {
    throw new Error('This subscription has no plan line we recognize. Contact support.');
  }

  return { baseItemId, basePriceLookupKey, seatItemId, seatQuantity };
}
