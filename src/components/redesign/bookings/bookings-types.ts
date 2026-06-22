// View-model types for the redesigned Operator Bookings screen. The View and
// its sub-components are pure functions of these shapes so they render the same
// from real hook data (OperatorBookings) or mock data (the dev preview).

/** Time-based working segments, mirroring the legacy bookings tabs. */
export type BookingSegment = "today" | "upcoming" | "active" | "past" | "all";

export const BOOKING_SEGMENTS: { id: BookingSegment; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "active", label: "Active" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
];

/** Raw DB appointment statuses. `confirmed` exists in the DB but maps to the
 *  StatusPill `scheduled` visual. */
export type BookingStatusKey =
  | "pending"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type StatusFilter = BookingStatusKey | "all";

export type PaymentTone = "paid" | "pending" | "failed" | "refunded" | "selfpay" | "none";

export type BookingPayment = { tone: PaymentTone; label: string };

/** One row in the list (desktop table row / mobile card). */
export type BookingRowVM = {
  id: string;
  dateLabel: string; // "Jun 25"
  weekdayLabel: string; // "Wed"
  timeLabel: string; // "10:30am"
  isToday: boolean;
  customer: string; // homeowner name, or org label for self-pay
  property: string; // address line
  service: string;
  durationLabel: string; // "2h" / "90m" / ""
  cleaner: string | null; // null => Unassigned
  cleanerAvatarUrl: string | null;
  status: BookingStatusKey;
  statusLabel: string;
  /** Short caption flagging a sub-state needing attention (null when none). */
  attention: string | null;
  /** Payment cell. null when the viewer can't see payments. */
  payment: BookingPayment | null;
  isUnassigned: boolean;
  isSelfPay: boolean;
};

export type CleanerOption = { id: string; name: string };

/** Actions emitted from a row's overflow menu. The fuller action set lives in
 *  the detail Sheet. */
export type BookingRowAction = "open" | "assign" | "cancel" | "delete";

/** A cleaner-suggested alternate time for a counter-proposed booking. */
export type CounterProposal = { id: string; label: string };

/** Full detail surface (slide-over Sheet). */
export type BookingDetailVM = {
  id: string;
  title: string; // property address
  service: string;
  dateLabel: string; // "Wednesday, Jun 25"
  timeLabel: string;
  durationLabel: string;
  status: BookingStatusKey;
  statusLabel: string;
  attention: string | null;
  customer: string;
  customerEmail: string | null;
  isSelfPay: boolean;
  cleaner: string | null;
  cleanerId: string | null;
  cleanerAvatarUrl: string | null;
  payment: BookingPayment | null;
  priceLabel: string | null; // "$120.00", gated by canViewPayments
  specialRequests: string | null;
  notes: string | null;
  isUnassigned: boolean;
  counterProposals: CounterProposal[];
  declinedReason: string | null;
};
