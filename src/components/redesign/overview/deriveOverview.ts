// Minimal shape deriveOverviewSections needs from an appointment. The real
// AdminAppointment (from useAdminAppointments) structurally satisfies this, so
// the wrapper can pass real rows and keep their full type via the generic.
export interface OverviewAppointment {
  status: string; // 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  cleaner_id?: string | null; // optional so the real AdminAppointment shape satisfies this constraint
  cleaner_confirmation_status?: string | null; // 'awaiting' | 'approved' | 'rejected'
  scheduled_date: string; // YYYY-MM-DD
  cleaner_availability_feedback?: unknown[] | null;
}

export type OverviewSections<T extends OverviewAppointment = OverviewAppointment> = {
  unassigned: T[];
  declined: T[];
  counterProposed: T[];
  today: T[];
  activeNow: T[];
};

/**
 * Bucket the appointments array into the Overview's sections. Pure + generic so
 * the hook wrapper keeps the real appointment type and the unit test can pass
 * minimal literals. `todayISO` is a YYYY-MM-DD string in the org's local day
 * (caller supplies it; matches how scheduled_date is stored).
 */
export function deriveOverviewSections<T extends OverviewAppointment>(
  appts: T[],
  todayISO: string
): OverviewSections<T> {
  const live = (a: T) => a.status !== "cancelled";
  return {
    unassigned: appts.filter((a) => live(a) && a.cleaner_id == null),
    declined: appts.filter((a) => live(a) && a.cleaner_confirmation_status === "rejected"),
    counterProposed: appts.filter((a) => live(a) && (a.cleaner_availability_feedback?.length ?? 0) > 0),
    today: appts.filter((a) => live(a) && a.scheduled_date === todayISO),
    activeNow: appts.filter((a) => a.status === "in_progress"),
  };
}
