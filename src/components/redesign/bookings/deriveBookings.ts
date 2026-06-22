import type { BookingSegment, StatusFilter } from "./bookings-types";

// Pure filtering/sorting for the Operator Bookings list. Mirrors the legacy
// BookingsPage predicates (time-based segments + free-text search + status +
// cleaner) so behavior is familiar, with no React or data-layer dependency so
// it can be unit-tested in isolation. Generic over the appointment shape so the
// container gets back its concrete AdminAppointment[] unchanged.

/** Minimal structural subset of an appointment used by the pure predicates. */
export type BookingsAppointment = {
  status: string;
  scheduled_date: string;
  scheduled_time?: string;
  cleaner_id?: string | null;
  cleaner_profile?: { user_profile?: { first_name?: string; last_name?: string } | null } | null;
  homeowner?: { first_name?: string; last_name?: string } | null;
  property?: { name?: string; address?: string; city?: string; state?: string } | null;
  service_type?: { name?: string } | null;
};

/** Local YYYY-MM-DD for a Date (NOT UTC) so "today" matches the user's day. */
export function localISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function matchesSegment(
  a: BookingsAppointment,
  segment: BookingSegment,
  today: string,
): boolean {
  const date = a.scheduled_date ?? "";
  const pendingOrConfirmed = a.status === "pending" || a.status === "confirmed";
  switch (segment) {
    case "active":
      return a.status === "in_progress";
    case "today":
      return date === today && pendingOrConfirmed;
    case "upcoming":
      return date > today && pendingOrConfirmed;
    case "past":
      return (
        a.status === "completed" ||
        a.status === "cancelled" ||
        (date < today && a.status !== "in_progress")
      );
    case "all":
    default:
      return true;
  }
}

function cleanerName(a: BookingsAppointment): string {
  const up = a.cleaner_profile?.user_profile;
  if (!up) return "";
  return `${up.first_name ?? ""} ${up.last_name ?? ""}`.trim();
}

function homeownerName(a: BookingsAppointment): string {
  const h = a.homeowner;
  if (!h) return "";
  return `${h.first_name ?? ""} ${h.last_name ?? ""}`.trim();
}

export function matchesSearch(a: BookingsAppointment, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    homeownerName(a),
    cleanerName(a),
    a.property?.name ?? "",
    a.property?.address ?? "",
    a.property?.city ?? "",
    a.property?.state ?? "",
    a.service_type?.name ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function matchesStatus(a: BookingsAppointment, filter: StatusFilter): boolean {
  return filter === "all" ? true : a.status === filter;
}

/** cleanerFilter: "all" | "unassigned" | a cleaner id. */
export function matchesCleaner(a: BookingsAppointment, cleanerFilter: string): boolean {
  if (cleanerFilter === "all") return true;
  if (cleanerFilter === "unassigned") return !a.cleaner_id;
  return a.cleaner_id === cleanerFilter;
}

function compare(a: BookingsAppointment, b: BookingsAppointment, descending: boolean): number {
  const ad = `${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`;
  const bd = `${b.scheduled_date ?? ""} ${b.scheduled_time ?? ""}`;
  const cmp = ad.localeCompare(bd);
  return descending ? -cmp : cmp;
}

export type DeriveBookingsOptions = {
  segment: BookingSegment;
  search: string;
  statusFilter: StatusFilter;
  cleanerFilter: string;
  today: string;
};

/** Filter + sort the appointment list for the active segment and filters. */
export function deriveBookings<T extends BookingsAppointment>(
  appointments: T[],
  opts: DeriveBookingsOptions,
): T[] {
  const { segment, search, statusFilter, cleanerFilter, today } = opts;
  const descending = segment === "past";
  return appointments
    .filter(
      (a) =>
        matchesSegment(a, segment, today) &&
        matchesSearch(a, search) &&
        matchesStatus(a, statusFilter) &&
        matchesCleaner(a, cleanerFilter),
    )
    .sort((a, b) => compare(a, b, descending));
}

/** Per-segment counts for the tab badges (search/status/cleaner-independent). */
export function segmentCounts(
  appointments: BookingsAppointment[],
  today: string,
): Record<BookingSegment, number> {
  const counts: Record<BookingSegment, number> = {
    today: 0,
    upcoming: 0,
    active: 0,
    past: 0,
    all: appointments.length,
  };
  for (const a of appointments) {
    if (matchesSegment(a, "today", today)) counts.today += 1;
    if (matchesSegment(a, "upcoming", today)) counts.upcoming += 1;
    if (matchesSegment(a, "active", today)) counts.active += 1;
    if (matchesSegment(a, "past", today)) counts.past += 1;
  }
  return counts;
}
