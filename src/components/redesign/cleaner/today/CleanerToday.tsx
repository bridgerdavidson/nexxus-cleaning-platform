"use client";

import { useRouter } from "next/navigation";
import { useCleanerAppointments } from "@/hooks/useCleanerData";
import { deriveToday } from "./deriveToday";
import { CleanerTodayView } from "./CleanerTodayView";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerToday() {
  const router = useRouter();
  const { appointments, loading } = useCleanerAppointments();

  const now = new Date();
  const todayStr = ymd(now);
  const tomorrowStr = ymd(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  // Slice 1 ships the contractor model only; the employee-model read is wired
  // in the placeholders slice. deriveToday already branches on this param.
  const data = deriveToday(appointments, todayStr, tomorrowStr, "percentage_contractor");

  // Deep actions bridge to the legacy panel (?appointment=) until Slice 2 ships
  // the in-redesign job detail. Never dead-ends.
  const openLegacy = (id: string) => router.push(`/cleaner-dashboard?appointment=${id}`);

  return (
    <CleanerTodayView
      data={data}
      loading={loading}
      onContinueActive={() => data.activeJob && openLegacy(data.activeJob.id)}
      onRespondOffer={openLegacy}
      onOpenJob={openLegacy}
      onSeeTomorrow={() => router.push("/app/cleaner-dashboard/schedule")}
    />
  );
}
