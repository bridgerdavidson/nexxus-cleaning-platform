import { isAppointmentOverdue } from "@/lib/isAppointmentOverdue";

// Minimal shape deriveOverviewSections needs from an appointment. The real
// AdminAppointment (from useAdminAppointments) structurally satisfies this, so
// the wrapper can pass real rows and keep their full type via the generic.
export interface OverviewAppointment {
  status: string; // 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  cleaner_id?: string | null; // optional so the real AdminAppointment shape satisfies this constraint
  cleaner_confirmation_status?: string | null; // 'awaiting' | 'approved' | 'rejected'
  scheduled_date: string; // YYYY-MM-DD
  cleaner_availability_feedback?: unknown[] | null;
  response_deadline?: string | null; // SLA deadline; drives the overdue bucket
}

export type OverviewSections<T extends OverviewAppointment = OverviewAppointment> = {
  unassigned: T[];
  declined: T[];
  counterProposed: T[];
  overdue: T[];
  today: T[];
  activeNow: T[];
};

type ActionBucket = "unassigned" | "declined" | "counterProposed" | "overdue";

/**
 * Single, mutually-exclusive classifier for the "Needs you now" action queue.
 * Mirrors the canonical action model (lib/appointments/actionReason) using the
 * fields useAdminAppointments provides, so every actionable appointment lands
 * in AT MOST one bucket:
 *
 * - A counter-proposal is a rejection WITH suggested times, so it must resolve
 *   to `counterProposed` only, never also to `declined` (the old filters
 *   double-counted it).
 * - An `awaiting` response past its `response_deadline` is `overdue` — a
 *   time-sensitive reassignment surface the old buckets dropped entirely.
 *
 * Returns null for appointments that need no admin action.
 */
function actionBucket(a: OverviewAppointment, now: Date): ActionBucket | null {
  if (a.status === "cancelled" || a.status === "completed") return null;

  if (a.cleaner_confirmation_status === "rejected") {
    return (a.cleaner_availability_feedback?.length ?? 0) > 0 ? "counterProposed" : "declined";
  }

  if (a.cleaner_id == null) return "unassigned";

  if (
    isAppointmentOverdue(
      {
        status: a.status,
        cleaner_confirmation_status: a.cleaner_confirmation_status as
          | "awaiting"
          | "approved"
          | "rejected"
          | null,
        response_deadline: a.response_deadline ?? null,
      },
      now,
    )
  ) {
    return "overdue";
  }

  return null;
}

/**
 * Bucket the appointments array into the Overview's sections. Pure + generic so
 * the hook wrapper keeps the real appointment type and the unit test can pass
 * minimal literals. `todayISO` is a YYYY-MM-DD string in the org's local day
 * (caller supplies it; matches how scheduled_date is stored). `now` drives the
 * overdue SLA check (caller-supplied so the test is deterministic).
 */
export function deriveOverviewSections<T extends OverviewAppointment>(
  appts: T[],
  todayISO: string,
  now: Date = new Date(),
): OverviewSections<T> {
  const live = (a: T) => a.status !== "cancelled";

  const unassigned: T[] = [];
  const declined: T[] = [];
  const counterProposed: T[] = [];
  const overdue: T[] = [];
  for (const a of appts) {
    switch (actionBucket(a, now)) {
      case "unassigned":
        unassigned.push(a);
        break;
      case "declined":
        declined.push(a);
        break;
      case "counterProposed":
        counterProposed.push(a);
        break;
      case "overdue":
        overdue.push(a);
        break;
    }
  }

  return {
    unassigned,
    declined,
    counterProposed,
    overdue,
    today: appts.filter((a) => live(a) && a.scheduled_date === todayISO),
    activeNow: appts.filter((a) => a.status === "in_progress"),
  };
}
