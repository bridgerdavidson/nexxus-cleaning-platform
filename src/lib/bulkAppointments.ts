import { supabase } from "./supabase";
import { chunk } from "./chunk";
import type { BulkAppointmentResult } from "./bulkAppointmentMessages";

export type {
  BulkAppointmentResult,
  BulkAppointmentAction,
} from "./bulkAppointmentMessages";
export { describeBulkAppointmentResult } from "./bulkAppointmentMessages";

// Rows per statement. Small enough that one batch stays well under the DB
// statement timeout even with the per-appointment cascade (payments, payouts,
// messages, job_photos, ...). Combined with sequential batching, this replaces
// the old `Promise.all(ids.map(deleteOne))` fan-out that could saturate the
// PostgREST connection pool and 504 unrelated requests (e.g. the auth bootstrap
// queries that load the workspace).
const BATCH_SIZE = 25;

/**
 * Hard-delete many appointments through the RLS-enforced client using a few
 * small, sequential, chunked `.in()` statements. Permission is enforced by the
 * appointments DELETE policy, so rows the user may not delete simply do not
 * come back in `.select()` and are counted as `failed`.
 */
export async function deleteAppointments(
  ids: string[],
): Promise<BulkAppointmentResult> {
  return runBulkAppointmentAction(ids, async (batch) => {
    const { data, error } = await supabase
      .from("appointments")
      .delete()
      .in("id", batch)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  });
}

/** Cancel (soft) many appointments the same chunked, sequential way. */
export async function cancelAppointments(
  ids: string[],
): Promise<BulkAppointmentResult> {
  return runBulkAppointmentAction(ids, async (batch) => {
    const { data, error } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .in("id", batch)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
  });
}

async function runBulkAppointmentAction(
  ids: string[],
  runBatch: (batch: string[]) => Promise<number>,
): Promise<BulkAppointmentResult> {
  const unique = Array.from(new Set(ids));
  let succeeded = 0;
  let firstError: string | undefined;

  // Sequential on purpose: one batch at a time, never concurrently. A single
  // overloaded or rejected batch records its error but does not stop the
  // remaining batches, so a transient failure on one chunk is recoverable.
  for (const batch of chunk(unique, BATCH_SIZE)) {
    try {
      succeeded += await runBatch(batch);
    } catch (e) {
      if (!firstError) {
        firstError = e instanceof Error ? e.message : "Bulk action failed";
      }
    }
  }

  return {
    requested: unique.length,
    succeeded,
    failed: unique.length - succeeded,
    error: firstError,
  };
}
