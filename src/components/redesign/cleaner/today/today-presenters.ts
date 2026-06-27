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
