import type { CleanerAppointment } from "@/hooks/useCleanerData";

export function formatTimeParts(time: string): { h: string; ap: string } {
  const [hRaw = "0", mRaw = "00"] = (time ?? "").split(":");
  const hour = Number(hRaw);
  const ap = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { h: `${h12}:${mRaw.padStart(2, "0")}`, ap };
}

export function propertyTitle(a: CleanerAppointment): string {
  return a.property?.name || a.property?.address || "Job";
}

export function jobSubtitle(a: CleanerAppointment): string {
  const service = a.service_type?.name ?? "";
  const customer = a.homeowner ? [a.homeowner.first_name, a.homeowner.last_name].filter(Boolean).join(" ") : "";
  return [service, customer].filter(Boolean).join(" · ");
}

/** Homeowner full name, or a clear label when the org is the payer (self-pay). */
export function customerLabel(a: CleanerAppointment): string {
  if (!a.homeowner) return "Company booking";
  const name = [a.homeowner.first_name, a.homeowner.last_name].filter(Boolean).join(" ").trim();
  return name || "Customer";
}

/** Single-line address, or null when no property is attached. */
export function propertyAddress(a: CleanerAppointment): string | null {
  const p = a.property;
  if (!p) return null;
  const cityState = [p.city, p.state].filter(Boolean).join(", ");
  const line2 = [cityState, p.zip_code].filter(Boolean).join(" ");
  const full = [p.address, line2].filter(Boolean).join(", ");
  return full || null;
}

/** A Google Maps search URL for a plain address string. */
export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** An Apple Maps search URL for a plain address string. */
export function appleMapsUrl(address: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
}

/** A Google Maps search link for the property address, or null. */
export function mapsUrl(a: CleanerAppointment): string | null {
  const addr = propertyAddress(a);
  if (!addr) return null;
  return googleMapsUrl(addr);
}

/**
 * Label for an offer's response deadline, e.g. "Respond by 9:00 PM". Returns
 * null when there is no (or an invalid) deadline so the caller can omit the pill.
 */
export function formatRespondBy(deadline?: string | null): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Respond by ${time}`;
}

/** "Monday, June 1, 2026" from a YYYY-MM-DD string, parsed in local time. */
export function formatDateLong(dateStr: string): string {
  const [y, m, d] = (dateStr ?? "").split("-").map(Number);
  if (!y || !m || !d) return dateStr ?? "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

/** "2h 30m" / "1h" / "45 min" from minutes, or null. */
export function formatDuration(minutes?: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Compact card date ("Wed, Jul 1"), null when it is today (date implied) or
 * invalid. Year appears only when it differs from today's year. */
export function formatCardDate(dateStr: string, todayStr: string): string | null {
  if (!dateStr || dateStr === todayStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const sameYear = todayStr.slice(0, 4) === String(y);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Compact "Sat, Jun 27 · 2:00 PM" string for the active-job meta row.
 * Always shows the date — unlike formatCardDate which suppresses today's date.
 */
export function formatJobWhen(dateStr: string, time: string): string {
  const [y, m, d] = (dateStr ?? "").split("-").map(Number);
  const dateLabel =
    y && m && d
      ? new Date(y, m - 1, d).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : (dateStr ?? "");
  const { h, ap } = formatTimeParts(time);
  return `${dateLabel} · ${h} ${ap}`;
}

export interface OfferSlot {
  slot_index: number;
  scheduled_date: string;
  scheduled_time: string;
}

/** The offered time slots for an appointment, sorted by slot_index. Falls back
 * to a single synthesized primary slot when none are attached (admin direct-book).
 * Single tested source of truth for slot derivation (used by the offer UI). */
export function offeredSlots(a: CleanerAppointment): OfferSlot[] {
  const slots = a.requested_slots;
  if (slots && slots.length > 0) return [...slots].sort((x, y) => x.slot_index - y.slot_index);
  return [{ slot_index: 0, scheduled_date: a.scheduled_date, scheduled_time: a.scheduled_time }];
}
