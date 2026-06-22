// View-model types for the redesigned Operator Customers screen. The View and
// its sub-components are pure functions of these shapes so they render the same
// from real hook data (OperatorCustomers) or mock data (the dev preview).

/** Sort options for the flat customer list. Customers have no time-based
 *  lifecycle segments (unlike Bookings), so the list is sorted, not segmented. */
export type CustomerSort = "recent" | "name" | "spent";

export const CUSTOMER_SORTS: { id: CustomerSort; label: string }[] = [
  { id: "recent", label: "Newest" },
  { id: "name", label: "Name (A to Z)" },
  { id: "spent", label: "Top spenders" },
];

/** Raw appointment statuses, used by the detail Sheet history list. */
export type CustomerHistoryStatus =
  | "pending"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

/** One row in the list (desktop table row / mobile card). */
export type CustomerRowVM = {
  id: string;
  name: string; // "Jane Smith", or the email when no name is set
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  initials: string;
  sinceLabel: string; // "Jun 2025"
  propertiesCount: number;
  appointmentsCount: number;
  /** "$1,240" gated by canViewPayments; null when hidden. */
  totalSpentLabel: string | null;
  /** "Last clean Jun 12" caption, or null when there is no history. */
  lastServiceLabel: string | null;
};

/** Actions emitted from a row's overflow menu. */
export type CustomerRowAction = "open" | "edit" | "delete";

/** A property owned by the customer (detail Sheet). */
export type CustomerPropertyVM = {
  id: string;
  name: string;
  address: string; // "123 Maple Ave, Austin, TX 78701"
  metaLabel: string; // "3 bd · 2 ba · 1,800 sqft" or ""
};

/** A past/upcoming appointment for the customer (detail Sheet history). */
export type CustomerHistoryVM = {
  id: string;
  dateLabel: string; // "Jun 12, 2026"
  service: string;
  property: string | null;
  status: CustomerHistoryStatus;
  priceLabel: string | null; // gated by canViewPayments
};

/** Full detail surface (slide-over Sheet). Profile comes from the list row;
 *  properties + history are loaded lazily via useCustomerDetails. */
export type CustomerDetailVM = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  initials: string;
  sinceLabel: string;
  propertiesCount: number;
  appointmentsCount: number;
  totalSpentLabel: string | null;
  /** Raw editable fields for the inline edit form. */
  firstName: string;
  lastName: string;
};
