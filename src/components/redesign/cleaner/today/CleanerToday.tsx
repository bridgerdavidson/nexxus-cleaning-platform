"use client";

import { useRouter } from "next/navigation";
import { useCleanerAppointments, useRespondToOffer } from "@/hooks/useCleanerData";
import { useOpenJob } from "@/components/redesign/cleaner/job/useOpenJob";
import { NEEDS_ATTENTION_DAYS } from "../shared/zones";
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
  const todayStr = ymd(now);
  const graceFloorStr = ymd(new Date(now.getTime() - NEEDS_ATTENTION_DAYS * 864e5));
  const data = deriveToday(appointments, todayStr, ymd(new Date(now.getTime() + 864e5)), graceFloorStr, "percentage_contractor");

  return (
    <CleanerTodayView
      data={data}
      loading={loading}
      onContinueActive={() => data.activeJob && openJob(data.activeJob.id)}
      onOpenJob={openJob}
      todayStr={todayStr}
      onAcceptOffer={(id, slotIndex) => respond.accept.mutateAsync({ appointmentId: id, slotIndex })}
      onDeclineOffer={(id, reason, other) => respond.decline.mutateAsync({ appointmentId: id, reason, other })}
      onSeeTomorrow={() => router.push("/app/cleaner-dashboard/schedule")}
    />
  );
}
