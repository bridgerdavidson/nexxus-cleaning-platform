import { isResponseOverdue } from '@/lib/appointments/isResponseOverdue';

// Minimal shape deriveOverviewSections needs from an appointment. The real
// AdminAppointment (from useAdminAppointments) structurally satisfies this, so
// the wrapper can pass real rows and keep their full type via the generic.
export interface OverviewAppointment {
  status: string; // 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  cleaner_id?: string | null; // optional so the real AdminAppointment shape satisfies this constraint
  cleaner_confirmation_status?: string | null; // 'awaiting' | 'approved' | 'rejected'
  scheduled_date: string; // YYYY-MM-DD
  cleaner_availability_feedback?: unknown[] | null;
  response_deadline?: string | null; // ISO timestamp the asked cleaner must respond by
  authorization_status?: string | null; // charge-outcome mirror: 'failed' | 'requires_action' | 'captured' | ...
}

export type OverviewSections<T extends OverviewAppointment = OverviewAppointment> = {
  unassigned: T[];
  declined: T[];
  counterProposed: T[];
  overdue: T[];
  failedPayment: T[];
  today: T[];
  activeNow: T[];
};

/**
 * Bucket the appointments array into the Overview's sections. Pure + generic so
 * the hook wrapper keeps the real appointment type and the unit test can pass
 * minimal literals. `todayISO` is a YYYY-MM-DD string in the org's local day
 * (caller supplies it; matches how scheduled_date is stored). `nowMs` is the
 * caller's clock for the overdue comparison (kept as a parameter so the
 * function stays pure).
 */
export function deriveOverviewSections<T extends OverviewAppointment>(
  appts: T[],
  todayISO: string,
  nowMs: number
): OverviewSections<T> {
  const live = (a: T) => a.status !== "cancelled";
  return {
    unassigned: appts.filter((a) => live(a) && a.cleaner_id == null),
    declined: appts.filter((a) => live(a) && a.cleaner_confirmation_status === "rejected"),
    counterProposed: appts.filter((a) => live(a) && (a.cleaner_availability_feedback?.length ?? 0) > 0),
    // The asked cleaner's response deadline has passed with no answer: the
    // auto-defer sweep may still re-route it, but until something changes the
    // booking is stalled and the operator is the backstop. Only 'pending'
    // qualifies (a confirmed/in-progress row has already resolved) and only
    // with a cleaner attached (a null cleaner is the unassigned bucket's job).
    overdue: appts.filter((a) => isResponseOverdue(a, nowMs)),
    // A completed job whose charge declined ('failed') or needs 3DS the customer isn't present
    // for ('requires_action'). Money already earned but not collected, so it belongs in the
    // operator's face, not just the Payments triage band. Deliberately NOT limited to upcoming
    // dates: these are completed jobs. Mirrors usePaymentsTriage's charge query.
    failedPayment: appts.filter(
      (a) => live(a) && (a.authorization_status === "failed" || a.authorization_status === "requires_action")
    ),
    today: appts.filter((a) => live(a) && a.scheduled_date === todayISO),
    activeNow: appts.filter((a) => a.status === "in_progress"),
  };
}
