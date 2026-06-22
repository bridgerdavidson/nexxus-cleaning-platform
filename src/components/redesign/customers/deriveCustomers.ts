import type { CustomerSort } from "./customers-types";

// Pure filtering/sorting for the Operator Customers list. Mirrors the legacy
// CustomersPage predicates (free-text search over name/email/phone + a recent/
// name/spent sort) with no React or data-layer dependency so it can be
// unit-tested in isolation. Generic over the customer shape so the container
// gets back its concrete AdminCustomer[] unchanged.

/** Minimal structural subset of a customer used by the pure predicates. */
export type CustomersCustomer = {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone?: string | null;
  created_at: string;
  total_spent?: number;
  last_appointment_date?: string | null;
};

function fullName(c: CustomersCustomer): string {
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
}

export function matchesCustomerSearch(c: CustomersCustomer, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = [fullName(c), c.email ?? "", c.phone ?? ""].join(" ").toLowerCase();
  return haystack.includes(q);
}

function compareName(a: CustomersCustomer, b: CustomersCustomer): number {
  const an = fullName(a) || (a.email ?? "");
  const bn = fullName(b) || (b.email ?? "");
  return an.localeCompare(bn, undefined, { sensitivity: "base" });
}

function compareRecent(a: CustomersCustomer, b: CustomersCustomer): number {
  // Newest first.
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

function compareSpent(a: CustomersCustomer, b: CustomersCustomer): number {
  return (b.total_spent ?? 0) - (a.total_spent ?? 0);
}

/** Returns a NEW sorted array (never mutates the input / query cache). */
export function sortCustomers<T extends CustomersCustomer>(list: T[], sort: CustomerSort): T[] {
  const copy = [...list];
  switch (sort) {
    case "name":
      copy.sort(compareName);
      break;
    case "spent":
      copy.sort(compareSpent);
      break;
    case "recent":
    default:
      copy.sort(compareRecent);
      break;
  }
  return copy;
}

export type DeriveCustomersOptions = {
  search: string;
  sort: CustomerSort;
};

/** Filter by the search query then sort by the chosen key. */
export function deriveCustomers<T extends CustomersCustomer>(
  customers: T[],
  opts: DeriveCustomersOptions,
): T[] {
  const filtered = customers.filter((c) => matchesCustomerSearch(c, opts.search));
  return sortCustomers(filtered, opts.sort);
}
