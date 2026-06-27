import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { JobActionMode } from "./job-detail-types";

// Single source of truth for slot derivation lives in the shared layer (it is
// the path the offer UI actually runs); re-exported here so its co-located test
// keeps covering the shipped function.
export { offeredSlots, type OfferSlot } from "../shared/job-presenters";

export function deriveJobActionMode(a: CleanerAppointment): JobActionMode {
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return "offer";
  if (a.status === "confirmed") return "start";
  if (a.status === "in_progress") return "continue";
  if (a.status === "completed") return "done";
  return "none";
}
