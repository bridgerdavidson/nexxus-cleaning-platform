"use client";

import { useRouter } from "next/navigation";
import { useCleanerAppointments, useRespondToOffer } from "@/hooks/useCleanerData";
import { useOpenJob } from "@/components/redesign/cleaner/job/useOpenJob";
import { deriveToday } from "./deriveToday";
import { CleanerTodayView } from "./CleanerTodayView";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerToday() {
  const router = useRouter();
  const openJob = useOpenJob();
  const { appointments, loading } = useCleanerAppointments();
  const respond = useRespondToOffer();

  const now = new Date();
  const data = deriveToday(appointments, ymd(now), ymd(new Date(now.getTime() + 864e5)), "percentage_contractor");

  // The active-job flow (photos/checklist/complete) is not in-redesign yet, so
  // "Continue job" bridges to the legacy wizard until Slice 3. All other taps
  // open the in-redesign job detail (?job=).
  const continueLegacy = (id: string) => router.push(`/cleaner-dashboard?appointment=${id}`);

  return (
    <CleanerTodayView
      data={data}
      loading={loading}
      onContinueActive={() => data.activeJob && continueLegacy(data.activeJob.id)}
      onOpenJob={openJob}
      onAcceptOffer={(id, slotIndex) => respond.accept.mutateAsync({ appointmentId: id, slotIndex })}
      onDeclineOffer={(id, reason, other) => respond.decline.mutateAsync({ appointmentId: id, reason, other })}
      onSeeTomorrow={() => router.push("/app/cleaner-dashboard/schedule")}
    />
  );
}
