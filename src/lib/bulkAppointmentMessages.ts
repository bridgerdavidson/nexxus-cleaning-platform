// Pure helpers for bulk appointment actions. Intentionally free of any Supabase
// import so the result/messaging logic stays unit-testable without DB env.

export interface BulkAppointmentResult {
  /** Distinct ids the caller asked to act on. */
  requested: number;
  /** Rows the database actually changed (may be < requested under RLS). */
  succeeded: number;
  /** requested - succeeded (RLS-blocked, already gone, or in a failed batch). */
  failed: number;
  /** First hard error encountered across the batches, if any. */
  error?: string;
}

export type BulkAppointmentAction = "delete" | "cancel";

/**
 * Build the user-facing toast text (and variant) for a bulk action result.
 * Pure and shared by every dashboard so the wording stays consistent.
 */
export function describeBulkAppointmentResult(
  action: BulkAppointmentAction,
  result: BulkAppointmentResult,
): { message: string; variant: "success" | "error" } {
  const verbPast = action === "delete" ? "Deleted" : "Cancelled";
  const verbedLower = action === "delete" ? "deleted" : "cancelled";
  const noun = result.succeeded === 1 ? "appointment" : "appointments";

  if (result.succeeded === 0) {
    if (result.error) {
      return {
        message: `Could not ${action} appointments: ${result.error}`,
        variant: "error",
      };
    }
    return {
      message: `No appointments were ${verbedLower}. You may not have permission, or they were already removed.`,
      variant: "error",
    };
  }

  if (result.failed > 0) {
    const tail = result.error
      ? `${result.failed} failed: ${result.error}`
      : `${result.failed} were skipped (no permission or already removed).`;
    return {
      message: `${verbPast} ${result.succeeded} of ${result.requested}. ${tail}`,
      variant: "error",
    };
  }

  return {
    message: `${verbPast} ${result.succeeded} ${noun}.`,
    variant: "success",
  };
}
