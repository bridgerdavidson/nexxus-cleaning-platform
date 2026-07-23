import type { TxnBadgeKey, PayoutBadgeKey, DisputeBadgeKey } from "./payments-types";

// Pure status -> single-descriptive-badge mapping for the Payments ledgers.

export function deriveTransactionBadge(status: string): TxnBadgeKey {
  switch (status) {
    case "paid":
      return "paid";
    case "processing":
      return "processing";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    default:
      return "pending"; // 'pending' and any unknown
  }
}

export function derivePayoutBadge(status: string): PayoutBadgeKey {
  switch (status) {
    case "paid":
    case "bank_paid":
      return "paid";
    case "failed":
      return "failed";
    case "reversed":
      return "reversed";
    case "approved":
      return "approved";
    default:
      return "held"; // 'pending' = held for cleaner onboarding
  }
}

export function deriveDisputeBadge(status: string): DisputeBadgeKey {
  switch (status) {
    case "needs_response":
      return "needs_response";
    case "warning_needs_response":
      return "warning";
    case "under_review":
    case "warning_under_review":
      return "under_review";
    case "won":
    case "prevented":
      return "won";
    case "lost":
      return "lost";
    case "warning_closed":
      return "closed";
    default:
      // Unknown/new Stripe status: treat as still-open so it never silently
      // hides from the operator (a dispute is money at risk until proven closed).
      return "needs_response";
  }
}
