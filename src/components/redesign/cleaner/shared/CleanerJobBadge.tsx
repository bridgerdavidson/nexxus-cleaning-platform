import { Badge } from "@/components/ui/badge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { CLEANER_JOB_BADGE, jobBadgeKey } from "./jobBadge";

export function CleanerJobBadge({ appointment, todayStr }: { appointment: CleanerAppointment; todayStr?: string }) {
  const c = CLEANER_JOB_BADGE[jobBadgeKey(appointment, todayStr)];
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}
