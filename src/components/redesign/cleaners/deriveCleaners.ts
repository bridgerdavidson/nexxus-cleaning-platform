import type { CleanerSort } from "./cleaners-types";

// Pure filtering/sorting for the Operator Cleaners roster. Free-text search over
// name/email/phone, a benched filter, and a name/load/earnings/recent sort, with
// no React or data-layer dependency so it can be unit-tested in isolation.
// Generic over the cleaner shape so the container gets back its concrete
// AdminCleanerScorecard[] unchanged.

/** Minimal structural subset of a cleaner used by the pure predicates. */
export type CleanersCleaner = {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone?: string | null;
  created_at: string;
  deactivated_at?: string | null;
  upcoming_this_week?: number;
  cleaner_earnings?: number;
};

function fullName(c: CleanersCleaner): string {
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
}

/** Pay fields consumed by the roster's pay chip (structural subset of AdminCleanerScorecard). */
export type CleanerPayFields = {
  payout_model: string;
  payout_percent: number;
  flat_rate_cents: number | null;
  payout_configured_at: string | null;
};

/** The pre-118 legacy spelling falls through to the percentage default branch by design. */
export function payLabelOf(c: CleanerPayFields): string {
  // Unconfigured wins over every mode branch: the stored mode is only the column
  // default, and rendering it (worst: "0% cut") would read as a real pay decision.
  if (c.payout_configured_at == null) return "Pay not set";
  if (c.payout_model === "request") return "Names their pay";
  if (c.payout_model === "flat") {
    if (c.flat_rate_cents == null) return "Flat rate not set";
    // Cents-aware (matches the detail sheet): $80.50 must not round to $81.
    const dollars = c.flat_rate_cents / 100;
    return `$${dollars.toLocaleString("en-US", {
      minimumFractionDigits: c.flat_rate_cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })} per job`;
  }
  if (c.payout_model === "hourly_external") return "Paid off platform";
  return `${Math.round(c.payout_percent)}% cut`;
}

export function matchesCleanerSearch(c: CleanersCleaner, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = [fullName(c), c.email ?? "", c.phone ?? ""].join(" ").toLowerCase();
  return haystack.includes(q);
}

function compareName(a: CleanersCleaner, b: CleanersCleaner): number {
  const an = fullName(a) || (a.email ?? "");
  const bn = fullName(b) || (b.email ?? "");
  return an.localeCompare(bn, undefined, { sensitivity: "base" });
}

function compareLoad(a: CleanersCleaner, b: CleanersCleaner): number {
  return (b.upcoming_this_week ?? 0) - (a.upcoming_this_week ?? 0);
}

function compareEarnings(a: CleanersCleaner, b: CleanersCleaner): number {
  return (b.cleaner_earnings ?? 0) - (a.cleaner_earnings ?? 0);
}

function compareRecent(a: CleanersCleaner, b: CleanersCleaner): number {
  // Newest first.
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

/** Returns a NEW sorted array (never mutates the input / query cache). */
export function sortCleaners<T extends CleanersCleaner>(list: T[], sort: CleanerSort): T[] {
  const copy = [...list];
  switch (sort) {
    case "load":
      copy.sort(compareLoad);
      break;
    case "earnings":
      copy.sort(compareEarnings);
      break;
    case "recent":
      copy.sort(compareRecent);
      break;
    case "name":
    default:
      copy.sort(compareName);
      break;
  }
  return copy;
}

export type DeriveCleanersOptions = {
  search: string;
  sort: CleanerSort;
  /** When false (default), benched (deactivated) cleaners are hidden. */
  showBenched?: boolean;
};

/** Hide benched cleaners (unless asked), filter by search, then sort. */
export function deriveCleaners<T extends CleanersCleaner>(
  cleaners: T[],
  opts: DeriveCleanersOptions,
): T[] {
  const visible = cleaners.filter((c) => {
    const benched = !!c.deactivated_at;
    if (benched && !opts.showBenched) return false;
    return matchesCleanerSearch(c, opts.search);
  });
  return sortCleaners(visible, opts.sort);
}
