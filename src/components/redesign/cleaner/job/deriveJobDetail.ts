import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { JobActionMode, OfferSlot } from "./job-detail-types";

export function deriveJobActionMode(a: CleanerAppointment): JobActionMode {
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return "offer";
  if (a.status === "confirmed") return "start";
  if (a.status === "in_progress") return "continue";
  if (a.status === "completed") return "done";
  return "none";
}

export function offeredSlots(a: CleanerAppointment): OfferSlot[] {
  const slots = a.requested_slots;
  if (slots && slots.length > 0) return [...slots].sort((x, y) => x.slot_index - y.slot_index);
  return [{ slot_index: 0, scheduled_date: a.scheduled_date, scheduled_time: a.scheduled_time }];
}
