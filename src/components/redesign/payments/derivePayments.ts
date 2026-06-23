import type { PaymentSort, TxnStatusFilter, PayoutStatusFilter } from "./payments-types";

// Pure filtering/sorting for the Operator Payments ledgers. No React or data-layer
// dependency so it unit-tests in isolation. Generic over the row shape so the
// container gets back its concrete AdminPayment[] / AdminPayout[] unchanged.

/** Minimal structural subset of a payment row used by the pure predicates. */
export type TxnLike = {
  amount: number;
  status: string;
  created_at: string;
  reference?: string | null;
  notes?: string | null;
  payment_method?: string | null;
  is_self_pay?: boolean;
  appointment?: {
    homeowner?: { first_name?: string; last_name?: string } | null;
    service_type?: { name?: string } | null;
  } | null;
};

/** Minimal structural subset of a payout row used by the pure predicates. */
export type PayoutLike = {
  amount: number;
  status: string;
  created_at: string;
  notes?: string | null;
  cleaner?: { first_name?: string; last_name?: string } | null;
};

function homeownerName(t: TxnLike): string {
  const h = t.appointment?.homeowner;
  if (!h) return "";
  return `${h.first_name ?? ""} ${h.last_name ?? ""}`.trim();
}
function cleanerName(p: PayoutLike): string {
  const c = p.cleaner;
  if (!c) return "";
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
}

export function matchesTxnSearch(t: TxnLike, rawQuery: string, orgName: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const payer = homeownerName(t) || (t.is_self_pay ? orgName : "");
  const haystack = [payer, t.reference ?? "", t.notes ?? "", t.appointment?.service_type?.name ?? ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function matchesPayoutSearch(p: PayoutLike, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = [cleanerName(p), p.notes ?? ""].join(" ").toLowerCase();
  return haystack.includes(q);
}

export function matchesTxnStatus(t: TxnLike, f: TxnStatusFilter): boolean {
  return f === "all" ? true : t.status === f;
}

/** Payout status filter folds the UI-friendly buckets onto the DB statuses:
 *  queued = held ('pending'); paid covers both the transfer 'paid' and 'bank_paid'. */
export function matchesPayoutStatus(p: PayoutLike, f: PayoutStatusFilter): boolean {
  if (f === "all") return true;
  if (f === "queued") return p.status === "pending";
  if (f === "paid") return p.status === "paid" || p.status === "bank_paid";
  return p.status === f;
}

function compareRecent(a: { created_at: string }, b: { created_at: string }): number {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}
function compareAmount(a: { amount: number }, b: { amount: number }): number {
  return (b.amount ?? 0) - (a.amount ?? 0);
}
function sortBy<T extends { created_at: string; amount: number }>(list: T[], sort: PaymentSort): T[] {
  const copy = [...list];
  copy.sort(sort === "amount" ? compareAmount : compareRecent);
  return copy;
}

export type DeriveTxnOptions = {
  search: string;
  statusFilter: TxnStatusFilter;
  sort: PaymentSort;
  orgName: string;
};
export function deriveTransactions<T extends TxnLike>(list: T[], opts: DeriveTxnOptions): T[] {
  const filtered = list.filter(
    (t) => matchesTxnSearch(t, opts.search, opts.orgName) && matchesTxnStatus(t, opts.statusFilter),
  );
  return sortBy(filtered, opts.sort);
}

export type DerivePayoutOptions = {
  search: string;
  statusFilter: PayoutStatusFilter;
  sort: PaymentSort;
};
export function derivePayouts<T extends PayoutLike>(list: T[], opts: DerivePayoutOptions): T[] {
  const filtered = list.filter(
    (p) => matchesPayoutSearch(p, opts.search) && matchesPayoutStatus(p, opts.statusFilter),
  );
  return sortBy(filtered, opts.sort);
}
