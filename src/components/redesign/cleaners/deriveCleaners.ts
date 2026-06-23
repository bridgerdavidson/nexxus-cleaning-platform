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
