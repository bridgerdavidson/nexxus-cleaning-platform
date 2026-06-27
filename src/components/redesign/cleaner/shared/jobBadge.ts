import type { ComponentType } from "react";
import { AlertTriangle, CalendarCheck, CalendarX, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { BadgeProps } from "@/components/ui/badge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { isUnfinished } from "./zones";

export type CleanerJobBadgeKey =
  | "needs_response" | "upcoming" | "in_progress" | "completed" | "cancelled" | "unfinished" | "expired";

export interface CleanerJobBadgeConfig {
  label: string;
  variant: BadgeProps["variant"];
  Icon: ComponentType<{ className?: string }>;
  /** Spin the icon for live work (respects reduced-motion). */
  spin?: boolean;
}

// Color hierarchy mirrors the operator badge vocabulary: amber = needs you /
// unfinished, gray = settled (upcoming/confirmed) or inactive (expired), blue
// (spinning) = live, green = done, red = cancelled.
export const CLEANER_JOB_BADGE: Record<CleanerJobBadgeKey, CleanerJobBadgeConfig> = {
  needs_response: { label: "Needs response", variant: "caution", Icon: Clock },
  upcoming: { label: "Upcoming", variant: "secondary", Icon: CalendarCheck },
  in_progress: { label: "In progress", variant: "default", Icon: Loader2, spin: true },
  completed: { label: "Done", variant: "positive", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "critical", Icon: XCircle },
  unfinished: { label: "Unfinished", variant: "caution", Icon: AlertTriangle },
  expired: { label: "Expired", variant: "secondary", Icon: CalendarX },
};

/** Pass todayStr to make the badge zone-aware (a stale confirmed/in_progress job
 * reads "Unfinished", a stale pending offer reads "Expired"). Without todayStr,
 * maps from status alone. */
export function jobBadgeKey(a: CleanerAppointment, todayStr?: string): CleanerJobBadgeKey {
  if (a.status === "cancelled") return "cancelled";
  if (a.status === "completed") return "completed";
  if (todayStr != null && (a.scheduled_date ?? "") < todayStr) {
    if (isUnfinished(a, todayStr)) return "unfinished";
    if (a.status === "pending") return "expired";
  }
  if (a.status === "in_progress") return "in_progress";
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return "needs_response";
  return "upcoming";
}
