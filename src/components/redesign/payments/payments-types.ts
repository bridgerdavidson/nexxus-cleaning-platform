// View-model + filter types for the redesigned Operator Payments screen.

export type PaymentLedger = "transactions" | "payouts";

export type PaymentSort = "recent" | "amount";
export const PAYMENT_SORTS: { id: PaymentSort; label: string }[] = [
  { id: "recent", label: "Newest" },
  { id: "amount", label: "Highest amount" },
];

export type TxnStatusFilter = "all" | "pending" | "processing" | "paid" | "failed" | "refunded";
export type PayoutStatusFilter = "all" | "queued" | "approved" | "paid" | "failed" | "reversed";

export const TXN_STATUS_FILTERS: { id: TxnStatusFilter; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "Awaiting completion" },
  { id: "processing", label: "Clearing" },
  { id: "paid", label: "Paid" },
  { id: "failed", label: "Failed" },
  { id: "refunded", label: "Refunded" },
];
export const PAYOUT_STATUS_FILTERS: { id: PayoutStatusFilter; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "queued", label: "Held" },
  // Legacy approved-but-unpaid rows were unfindable except by scrolling "All" (T2-16).
  { id: "approved", label: "Approved" },
  { id: "paid", label: "Paid" },
  { id: "failed", label: "Failed" },
  { id: "reversed", label: "Reversed" },
];

export type TxnBadgeKey = "paid" | "processing" | "pending" | "failed" | "refunded";
export type PayoutBadgeKey = "paid" | "held" | "failed" | "reversed" | "approved";

/** Stripe refund reasons the refund route accepts (`amount` omitted = full). */
export type RefundReason = "requested_by_customer" | "duplicate" | "fraudulent";
export const REFUND_REASONS: { id: RefundReason; label: string }[] = [
  { id: "requested_by_customer", label: "Requested by customer" },
  { id: "duplicate", label: "Duplicate charge" },
  { id: "fraudulent", label: "Fraudulent" },
];

export type TransactionRowVM = {
  id: string;
  dateLabel: string; // "Jun 20, 2026"
  payer: string; // homeowner name OR org name
  selfPay: boolean;
  service: string; // service_type name or "Cleaning"
  amountLabel: string; // "$120.00"
  method: string; // "Card" | "ACH" | "Manual"
  badge: TxnBadgeKey;
  /** True when an OPEN chargeback hit this payment, so the row shows a
   *  "Disputed" flag instead of reading as a clean "Paid". */
  disputed?: boolean;
  /** Some money was refunded but the payment isn't fully refunded yet, so the
   *  row shows a "Partial refund" flag next to "Paid". */
  partiallyRefunded?: boolean;
};

export type PayoutRowVM = {
  id: string;
  dateLabel: string;
  cleaner: string; // cleaner name or "Cleaner"
  amountLabel: string;
  badge: PayoutBadgeKey;
};

export type TransactionDetailVM = TransactionRowVM & {
  /** The booking this charge belongs to, for the "View booking" jump. Null when
   *  the payment has no linked appointment. */
  appointmentId: string | null;
  reference: string | null;
  notes: string | null;
  createdLabel: string;
  paidLabel: string | null;
  /** canRefund && status==='paid' && has a PaymentIntent && something left to refund. */
  refundable: boolean;
  /** Refunded-so-far display ("$80.00"), null when nothing refunded. */
  refundedLabel: string | null;
  grossAmount: number; // dollars, for the refund dialog
  refundedAmount: number; // dollars already refunded / in-flight
  remainingRefundable: number; // dollars still refundable
  /** Failed cancellation/no-show fee: shows the "Retry fee charge" action (T2-7). */
  feeRetryable: boolean;
  /** The last attempt bounced on 3DS; retry only helps after a card change. */
  feeNeedsCardVerification: boolean;
};

export type PayoutDetailVM = PayoutRowVM & {
  cleanerId: string | null;
  appointmentId: string | null;
  notes: string | null;
  createdLabel: string;
  approvedLabel: string | null;
  paidLabel: string | null;
  rawStatus: string; // to choose footer actions
};

export type TriageChargeVM = {
  apptId: string;
  payer: string;
  amountLabel: string;
  dateLabel: string;
  reason: "failed" | "requires_action";
  homeownerId: string | null;
  canSendLink: boolean; // homeowner_id && !is_self_pay
};
export type TriagePayoutVM = { id: string; cleaner: string; amountLabel: string };
export type TriageHeldVM = { cleanerId: string | null; cleaner: string; amountLabel: string };

// --- Disputes (chargebacks) ---

export type DisputeBadgeKey =
  | "needs_response" // open, action required (Stripe needs_response)
  | "warning" // early fraud warning, respond to avoid escalation
  | "under_review" // evidence submitted, waiting on the bank
  | "won" // resolved in our favor (incl. 'prevented')
  | "lost" // resolved against us
  | "closed"; // warning_closed / other terminal

/** How close the evidence deadline is, for the "Respond by" pill tone. */
export type DisputeDeadlineUrgency = "overdue" | "soon" | "later" | "none";

export type DisputeRowVM = {
  id: string;
  payer: string; // homeowner name OR org name
  service: string; // service_type name or "Cleaning"
  amountLabel: string; // disputed amount, "$120.00"
  openedLabel: string; // when the dispute was created
  reason: string; // humanized reason string
  badge: DisputeBadgeKey;
  isOpen: boolean; // still actionable (not won/lost/closed)
  deadlineLabel: string | null; // "Jun 20, 2026" or null when Stripe set none
  urgency: DisputeDeadlineUrgency;
};

export type DisputeDetailVM = DisputeRowVM & {
  rawStatus: string; // raw Stripe status, for reference
  method: string; // charged payment method label
  paymentDateLabel: string | null; // the job's scheduled date
  homeownerId: string | null; // for "Message customer" (null for self-pay / no homeowner)
  stripeDisputeId: string;
};
