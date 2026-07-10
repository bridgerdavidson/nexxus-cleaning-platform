import { type AdminAppointment } from "@/hooks/useAdminData";
import { deriveBookingBadge } from "./deriveBookings";
import type {
  BookingDetailVM,
  BookingPayment,
  BookingRowVM,
  BookingStatusKey,
  CounterProposal,
  CounterWindow,
} from "./bookings-types";

// --- formatting helpers (AdminAppointment -> view-model) ---
// Moved verbatim from OperatorBookings.tsx so the shell-level booking-detail
// host and the bookings screen share one VM builder.

export function fmtTime(t: string | undefined): string {
  const [hh, mm] = (t ?? "").split(":");
  let h = parseInt(hh ?? "0", 10);
  if (Number.isNaN(h)) return t ?? "";
  const m = mm ?? "00";
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m}${ap}`;
}
export function monthDay(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function weekday(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
function longDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function durationLabel(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function propertyAddress(a: AdminAppointment): string {
  return a.property?.address || a.property?.name || "Property";
}
function serviceLabel(a: AdminAppointment): string {
  return a.service_type?.name || "Cleaning";
}
function customerLabel(a: AdminAppointment): string {
  const name = `${a.homeowner?.first_name ?? ""} ${a.homeowner?.last_name ?? ""}`.trim();
  if (name) return name;
  return a.is_self_pay ? "Self-pay booking" : "Customer";
}
function cleanerLabel(a: AdminAppointment): string | null {
  const up = a.cleaner_profile?.user_profile;
  if (!up) return null;
  const name = `${up.first_name ?? ""} ${up.last_name ?? ""}`.trim();
  return name || null;
}

function paymentVM(a: AdminAppointment, canView: boolean): BookingPayment | null {
  if (!canView) return null;
  if (a.is_self_pay) return { tone: "selfpay", label: "Self-pay" };
  switch (a.payment_status) {
    case "paid":
      return { tone: "paid", label: "Paid" };
    case "pending":
      return { tone: "pending", label: "Pending" };
    case "failed":
      return { tone: "failed", label: "Failed" };
    case "refunded":
      return { tone: "refunded", label: "Refunded" };
    default:
      return { tone: "none", label: "Unpaid" };
  }
}

function priceLabel(a: AdminAppointment, canView: boolean): string | null {
  if (!canView) return null;
  const total = a.price_override_enabled ? a.price_override_total : a.total_price;
  if (total == null) return null;
  return `$${Number(total).toFixed(2)}`;
}

function counterProposals(a: AdminAppointment): CounterProposal[] {
  const out: CounterProposal[] = [];
  for (const f of a.cleaner_availability_feedback ?? []) {
    for (const t of f.cleaner_suggested_times ?? []) {
      out.push({
        id: t.id,
        label: `${monthDay(t.suggested_date)} at ${fmtTime(t.suggested_time)}`,
        date: t.suggested_date,
        time: t.suggested_time,
      });
    }
  }
  return out;
}

function counterWindows(a: AdminAppointment): CounterWindow[] {
  const out: CounterWindow[] = [];
  for (const f of a.cleaner_availability_feedback ?? []) {
    for (const w of f.cleaner_suggested_windows ?? []) {
      out.push({
        id: w.id,
        label: `${monthDay(w.window_date)}, ${fmtTime(w.start_time)} to ${fmtTime(w.end_time)}`,
        date: w.window_date,
        startTime: w.start_time,
        endTime: w.end_time,
      });
    }
  }
  return out;
}

export function toRowVM(
  a: AdminAppointment,
  today: string,
  canViewPayments: boolean,
  avatarById: Map<string, string | null>,
): BookingRowVM {
  const status = a.status as BookingStatusKey;
  return {
    id: a.id,
    dateLabel: monthDay(a.scheduled_date),
    weekdayLabel: weekday(a.scheduled_date),
    timeLabel: fmtTime(a.scheduled_time),
    isToday: a.scheduled_date === today,
    customer: customerLabel(a),
    property: propertyAddress(a),
    service: serviceLabel(a),
    durationLabel: durationLabel(a.duration_minutes),
    cleaner: cleanerLabel(a),
    cleanerAvatarUrl: a.cleaner_id ? avatarById.get(a.cleaner_id) ?? null : null,
    status,
    badge: deriveBookingBadge(a),
    payment: paymentVM(a, canViewPayments),
    isUnassigned: !a.cleaner_id,
    isSelfPay: !!a.is_self_pay,
  };
}

export function toDetailVM(a: AdminAppointment, canViewPayments: boolean): BookingDetailVM {
  const status = a.status as BookingStatusKey;
  return {
    id: a.id,
    title: propertyAddress(a),
    service: serviceLabel(a),
    dateLabel: longDate(a.scheduled_date),
    timeLabel: fmtTime(a.scheduled_time),
    durationLabel: durationLabel(a.duration_minutes),
    status,
    badge: deriveBookingBadge(a),
    customer: customerLabel(a),
    customerEmail: a.homeowner?.email ?? null,
    customerId: a.homeowner_id ?? null,
    isSelfPay: !!a.is_self_pay,
    cleaner: cleanerLabel(a),
    cleanerId: a.cleaner_id ?? null,
    cleanerAvatarUrl: null,
    payment: paymentVM(a, canViewPayments),
    priceLabel: priceLabel(a, canViewPayments),
    specialRequests: a.special_requests ?? null,
    notes: a.notes ?? null,
    isUnassigned: !a.cleaner_id,
    counterProposals: counterProposals(a),
    counterWindows: counterWindows(a),
    declinedReason: a.cleaner_availability_feedback?.[0]?.reason ?? null,
  };
}
