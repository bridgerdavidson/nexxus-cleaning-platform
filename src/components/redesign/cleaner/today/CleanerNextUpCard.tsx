"use client";

import { Play } from "lucide-react";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { Button } from "@/components/ui/button";
import { CleanerDirectionsButton } from "../shared/CleanerDirectionsButton";
import { propertyTitle, jobSubtitle, propertyAddress, formatTimeParts } from "../shared/job-presenters";

/**
 * The cleaner's most-imminent not-yet-started job, lifted into a prominent card so
 * the two things they do on arrival, start the job and navigate to it, are one tap
 * each instead of a trip through the job detail. Brand-outlined (not solid) so it
 * reads as "up next", one step below the solid-blue active-job card. Tapping the
 * info area still opens the full job.
 */
export function CleanerNextUpCard({
  appointment,
  onStart,
  starting,
  onOpenJob,
}: {
  appointment: CleanerAppointment;
  onStart: (id: string) => void;
  starting: boolean;
  onOpenJob: (id: string) => void;
}) {
  const { h, ap } = formatTimeParts(appointment.scheduled_time ?? "");
  const address = propertyAddress(appointment) ?? "";

  return (
    <div className="rounded-card border-2 border-brand-600 bg-card p-4 shadow-soft-md">
      <button
        type="button"
        onClick={() => onOpenJob(appointment.id)}
        className="block w-full rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-brand-700">
          Next up · {h} {ap}
        </div>
        <div className="mt-0.5 text-lg font-extrabold">{propertyTitle(appointment)}</div>
        <div className="text-xs text-muted-foreground">{jobSubtitle(appointment)}</div>
      </button>
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" onClick={() => onStart(appointment.id)} loading={starting}>
          <Play className="size-5" aria-hidden />
          Start
        </Button>
        <CleanerDirectionsButton address={address} className="flex-1" />
      </div>
    </div>
  );
}
