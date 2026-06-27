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

export function statusBadge(a: CleanerAppointment): { label: string; tone: "blue" | "amber" | "gray" | "green" } {
  if (a.status === "in_progress") return { label: "In progress", tone: "blue" };
  if (a.status === "completed") return { label: "Done", tone: "green" };
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return { label: "Needs response", tone: "amber" };
  return { label: "Upcoming", tone: "gray" };
}

/**
 * Label for an offer's response deadline, e.g. "Respond by 9:00 PM". Returns
 * null when there is no (or an invalid) deadline so the caller can omit the
 * pill. Uses the viewer's locale time; day is intentionally omitted (deadlines
 * are near-term and the offer's own date is already shown on the card).
 */
export function formatRespondBy(deadline?: string | null): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Respond by ${time}`;
}
