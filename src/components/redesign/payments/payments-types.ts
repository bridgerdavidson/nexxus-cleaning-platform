// View-model + filter types for the redesigned Operator Payments screen.

export type PaymentLedger = "transactions" | "payouts";

export type PaymentSort = "recent" | "amount";
export const PAYMENT_SORTS: { id: PaymentSort; label: string }[] = [
  { id: "recent", label: "Newest" },
  { id: "amount", label: "Highest amount" },
];

export type TxnStatusFilter = "all" | "pending" | "processing" | "paid" | "failed" | "refunded";
export type PayoutStatusFilter = "all" | "queued" | "paid" | "failed" | "reversed";

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
  { id: "paid", label: "Paid" },
  { id: "failed", label: "Failed" },
  { id: "reversed", label: "Reversed" },
];

export type TxnBadgeKey = "paid" | "processing" | "pending" | "failed" | "refunded";
export type PayoutBadgeKey = "paid" | "held" | "failed" | "reversed" | "approved";

export type TransactionRowVM = {
  id: string;
  dateLabel: string; // "Jun 20, 2026"
  payer: string; // homeowner name OR org name
  selfPay: boolean;
  service: string; // service_type name or "Cleaning"
  amountLabel: string; // "$120.00"
  method: string; // "Card" | "ACH" | "Manual"
  badge: TxnBadgeKey;
};

export type PayoutRowVM = {
  id: string;
  dateLabel: string;
  cleaner: string; // cleaner name or "Cleaner"
  amountLabel: string;
  badge: PayoutBadgeKey;
};

export type TransactionDetailVM = TransactionRowVM & {
  reference: string | null;
  notes: string | null;
  createdLabel: string;
  paidLabel: string | null;
  refundable: boolean; // canRefund && status==='paid' && method card
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
