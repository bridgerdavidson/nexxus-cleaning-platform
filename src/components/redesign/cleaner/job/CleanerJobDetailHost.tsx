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

  return (
    <CleanerJobDetailOverlay
      key={paramId}
      appointment={appointment}
      loading={loading}
      onClosed={() => setParam(null)}
      onStart={() => startJob.mutateAsync(paramId)}
      starting={startJob.isPending}
      onContinue={() => router.push(`/cleaner-dashboard?appointment=${paramId}`)}
      onAcceptOffer={(slotIndex) => respond.accept.mutateAsync({ appointmentId: paramId, slotIndex })}
      onDeclineOffer={(reason, other) => respond.decline.mutateAsync({ appointmentId: paramId, reason, other })}
    />
  );
}
