import type { TxnBadgeKey, PayoutBadgeKey } from "./payments-types";

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
