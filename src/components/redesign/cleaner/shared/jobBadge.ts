import type { ComponentType } from "react";
import { CalendarCheck, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { BadgeProps } from "@/components/ui/badge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type CleanerJobBadgeKey =
  | "needs_response" | "upcoming" | "in_progress" | "completed" | "cancelled";

export interface CleanerJobBadgeConfig {
  label: string;
  variant: BadgeProps["variant"];
  Icon: ComponentType<{ className?: string }>;
  /** Spin the icon for live work (respects reduced-motion). */
  spin?: boolean;
}

// Color hierarchy mirrors the operator badge vocabulary: amber = needs you,
// gray = settled (upcoming/confirmed), blue (spinning) = live, green = done,
// red = cancelled.
export const CLEANER_JOB_BADGE: Record<CleanerJobBadgeKey, CleanerJobBadgeConfig> = {
  needs_response: { label: "Needs response", variant: "caution", Icon: Clock },
  upcoming: { label: "Upcoming", variant: "secondary", Icon: CalendarCheck },
  in_progress: { label: "In progress", variant: "default", Icon: Loader2, spin: true },
  completed: { label: "Done", variant: "positive", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "critical", Icon: XCircle },
};

export function jobBadgeKey(a: CleanerAppointment): CleanerJobBadgeKey {
  if (a.status === "cancelled") return "cancelled";
  if (a.status === "completed") return "completed";
  if (a.status === "in_progress") return "in_progress";
  if (a.status === "pending" && a.cleaner_confirmation_status === "awaiting") return "needs_response";
  return "upcoming";
}
