"use client";

import { useRouter } from "next/navigation";
import { useCleanerAppointments, useRespondToOffer } from "@/hooks/useCleanerData";
import { deriveToday } from "./deriveToday";
import { CleanerTodayView } from "./CleanerTodayView";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerToday() {
  const router = useRouter();
  const { appointments, loading } = useCleanerAppointments();
  const respond = useRespondToOffer();

  const now = new Date();
  const data = deriveToday(appointments, ymd(now), ymd(new Date(now.getTime() + 864e5)), "percentage_contractor");

  // Job-detail + active-job flow are not in-redesign yet here; bridge to legacy
  // until Task 9 (job detail) / Slice 3 (active-job flow).
  const openLegacy = (id: string) => router.push(`/cleaner-dashboard?appointment=${id}`);

  return (
    <CleanerTodayView
      data={data}
      loading={loading}
      onContinueActive={() => data.activeJob && openLegacy(data.activeJob.id)}
      onOpenJob={openLegacy}
      onAcceptOffer={(id, slotIndex) => respond.accept.mutateAsync({ appointmentId: id, slotIndex })}
      onDeclineOffer={(id, reason, other) => respond.decline.mutateAsync({ appointmentId: id, reason, other })}
      onSeeTomorrow={() => router.push("/app/cleaner-dashboard/schedule")}
    />
  );
}
