"use client";

import { useRouter } from "next/navigation";
import { useDetailParam } from "@/hooks/useDetailParam";
import { useCleanerAppointments, useStartJob, useRespondToOffer } from "@/hooks/useCleanerData";
import { CleanerJobDetailOverlay } from "./CleanerJobDetailOverlay";

export function CleanerJobDetailHost() {
  const router = useRouter();
  const { paramId, setParam } = useDetailParam("job");
  const { appointments, loading } = useCleanerAppointments();
  const startJob = useStartJob();
  const respond = useRespondToOffer();

  if (!paramId) return null;
  const appointment = appointments.find((a) => a.id === paramId) ?? null;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <CleanerJobDetailOverlay
      key={paramId}
      appointment={appointment}
      loading={loading}
      todayStr={todayStr}
      onClosed={() => setParam(null)}
      onStart={() => startJob.mutateAsync(paramId)}
      starting={startJob.isPending}
      onContinue={() => router.push(`/cleaner-dashboard?appointment=${paramId}`)}
      onAcceptOffer={(slotIndex) => respond.accept.mutateAsync({ appointmentId: paramId, slotIndex })}
      onDeclineOffer={(reason, other) => respond.decline.mutateAsync({ appointmentId: paramId, reason, other })}
    />
  );
}
