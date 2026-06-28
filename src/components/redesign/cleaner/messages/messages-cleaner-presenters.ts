// React-free: map the cleaner's OWN appointment (CleanerAppointment) to the shared
// message VMs. The operator's toInlineBookingVM is typed to AdminAppointment, so the
// cleaner needs its own mapper (the VM types themselves are shared).
import { fmtTime } from "@/components/redesign/messages/messages-format";
import type {
  BookingStatus,
  ContactBookingVM,
  InlineBookingVM,
} from "@/components/redesign/messages/messages-types";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

function apptDate(scheduledDate: string): Date {
  return new Date(`${scheduledDate}T00:00:00`);
}
function serviceLabel(appt: CleanerAppointment): string {
  return appt.service_type?.name || appt.checklist?.name || "Cleaning";
}
function addressLabel(appt: CleanerAppointment): string | null {
  return appt.property?.name || appt.property?.address || null;
}

/** Inline booking card shown on a job-tagged message in the thread. */
export function cleanerApptToInlineBookingVM(
  appt: CleanerAppointment | undefined,
  appointmentId: string,
): InlineBookingVM {
  if (!appt) {
    return {
      appointmentId,
      found: false,
      service: "Booking",
      dateLabel: "",
      timeLabel: "",
      address: null,
      cleanerName: null,
      status: "confirmed",
    };
  }
  return {
    appointmentId,
    found: true,
    service: serviceLabel(appt),
    dateLabel: apptDate(appt.scheduled_date).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    timeLabel: fmtTime(appt.scheduled_time),
    address: addressLabel(appt),
    cleanerName: null,
    status: (appt.status as BookingStatus) ?? "confirmed",
  };
}

/** Staged "Re: <job>" chip above the composer when messaging the office about a job. */
export function cleanerApptToContactBookingVM(appt: CleanerAppointment): ContactBookingVM {
  const d = apptDate(appt.scheduled_date);
  return {
    appointmentId: appt.id,
    service: serviceLabel(appt),
    dateLabel: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    timeLabel: fmtTime(appt.scheduled_time),
    address: addressLabel(appt),
    status: (appt.status as BookingStatus) ?? "confirmed",
    dayNum: String(d.getDate()),
    monthLabel: d.toLocaleDateString("en-US", { month: "short" }),
  };
}
