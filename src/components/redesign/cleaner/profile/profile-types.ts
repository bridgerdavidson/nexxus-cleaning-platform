// View-model types for the cleaner Profile + read-only Services catalog.

/** A name-bearing shape (the camelCase auth profile shim). */
export interface ProfileNameLike {
  firstName?: string | null;
  lastName?: string | null;
}

/** One row in the read-only services catalog list. */
export type CatalogRowVM = {
  id: string;
  name: string;
  priceLabel: string; // "$120" or "$120+" when paid add-on tiers exist
  durationLabel: string; // "2h" / "1h 30m"
  serviceTypeLabel: string; // "Regular Cleaning"
  isActive: boolean;
};

/** One task inside a tier. */
export type CatalogTaskVM = { id: string; task: string };

/** One tier (checklist) of a service. */
export type CatalogTierVM = {
  id: string;
  name: string;
  adderLabel: string; // "Included" or "+$40"
  tasks: CatalogTaskVM[];
};

/** The read-only service detail view-model. */
export type CatalogDetailVM = {
  id: string;
  name: string;
  description: string | null;
  priceRangeLabel: string; // "$120" or "$120 to $160"
  durationLabel: string;
  serviceTypeLabel: string;
  tiers: CatalogTierVM[];
};
