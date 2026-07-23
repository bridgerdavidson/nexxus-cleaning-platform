import { formatTimeParts, propertyTitle, jobSubtitle, rowAddressLine, formatCardDate } from "./job-presenters";
import { CleanerJobBadge } from "./CleanerJobBadge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

export function JobRow({
  appointment, onClick, todayStr,
}: {
  appointment: CleanerAppointment;
  onClick: () => void;
  todayStr?: string;
}) {
  const t = formatTimeParts(appointment.scheduled_time);
  const address = rowAddressLine(appointment);
  const dateLabel = todayStr ? formatCardDate(appointment.scheduled_date, todayStr) : null;
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-3 text-left shadow-soft-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="w-14 flex-none text-center">
        <div className="text-sm font-extrabold tabular-nums">{t.h}</div>
        <div className="text-[10px] font-bold text-muted-foreground">{t.ap}</div>
      </div>
      <div className="self-stretch w-px bg-border" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{propertyTitle(appointment)}</div>
        <div className="truncate text-xs text-muted-foreground">{jobSubtitle(appointment)}</div>
        {address && <div className="truncate text-xs text-muted-foreground">{address}</div>}
        {dateLabel && <div className="mt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{dateLabel}</div>}
      </div>
      <CleanerJobBadge appointment={appointment} todayStr={todayStr} />
    </button>
  );
}
