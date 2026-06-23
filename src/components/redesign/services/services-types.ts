// View-model types for the redesigned Operator Services screen. The View and its
// sub-components render the same from real hook data (OperatorServices) or mocks.

export type ServiceSort = "name" | "recent" | "price";
export type ServiceStatusFilter = "active" | "all" | "inactive";

export const SERVICE_SORTS: { id: ServiceSort; label: string }[] = [
  { id: "name", label: "Name (A to Z)" },
  { id: "recent", label: "Recently updated" },
  { id: "price", label: "Price (low to high)" },
];

export const SERVICE_STATUS_FILTERS: { id: ServiceStatusFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "inactive", label: "Inactive" },
];

/** One row in the left list. */
export type ServiceRowVM = {
  id: string;
  name: string;
  priceLabel: string; // "$120" or "$120+" when the service has paid add-on tiers
  durationLabel: string; // "90m" / "1h 30m"
  serviceTypeLabel: string; // "Move Out"
  isActive: boolean;
};

/** Header of the right detail pane. */
export type ServiceDetailVM = {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  basePriceLabel: string; // "$120"
  durationMinutes: number;
  durationLabel: string;
  serviceType: string; // raw, e.g. "move_out"
  serviceTypeLabel: string;
  isActive: boolean;
  priceRangeLabel: string; // "$120" or "$120 to $160"
};

/** One task inside a checklist. */
export type TaskVM = { id: string; task: string };

/** One checklist (tier) of a service. */
export type ChecklistVM = {
  id: string;
  name: string;
  priceAdder: number;
  priceAdderLabel: string; // "+$20" or "+$0"
  tasks: TaskVM[];
};
