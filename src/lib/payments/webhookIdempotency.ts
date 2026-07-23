/**
 * Stripe webhook idempotency + dead-letter bookkeeping (Phase 4b).
 *
 * Every delivered event is *claimed* in `webhook_events` (PK = Stripe event id) BEFORE we
 * act on it. A delivery whose event row is already `processed` short-circuits (a true
 * duplicate from Stripe's automatic retries). Rows left `received`/`failed` are eligible for
 * reprocessing — the individual handlers are idempotent, and the reconciliation sweep is the
 * backstop for when Stripe stops retrying (decision: DB correctness never depends on a single
 * webhook delivery succeeding).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type WebhookClaim = 'claimed' | 'duplicate';

/**
 * A 'received' row younger than this is treated as an in-flight concurrent delivery (skip);
 * older than this it's assumed a prior worker crashed mid-process and is safe to reclaim. A
 * normal webhook finishes in seconds, so 60s comfortably separates the two cases.
 */
const IN_FLIGHT_WINDOW_MS = 60_000;

/**
 * Try to claim an event for processing. Returns 'duplicate' only when we've already fully
 * processed this exact event id; otherwise 'claimed' (including the first-ever delivery and
 * any re-delivery of an event that previously failed mid-flight).
 */
export async function claimWebhookEvent(
  supabase: SupabaseClient,
  ev: { id: string; type: string; accountId?: string | null },
): Promise<WebhookClaim> {
  // Insert-first: the primary-key race elects a single winner across concurrent deliveries.
  const { error } = await supabase.from('webhook_events').insert({
    id: ev.id,
    type: ev.type,
    account_id: ev.accountId ?? null,
    status: 'received',
  });

  if (!error) return 'claimed';

  // Only a unique-violation (23505) means we've genuinely seen this event id before. Any other
  // error (transient DB/connection failure, etc.) must NOT fall through to "claimed" — doing so
  // would let the handler run with no persisted idempotency claim, so a later retry would
  // reprocess and duplicate side effects. Throw so the caller returns 5xx and Stripe retries.
  if (error.code !== '23505') {
    throw new Error(`claimWebhookEvent: failed to claim ${ev.id} (${error.code ?? 'unknown'}): ${error.message}`);
  }

  // Conflict on the id — decide based on the existing row's state:
  //   processed            → true duplicate (skip)
  //   dead                 → terminally abandoned by the dead-letter sweep (T1-10); a human replays it
  //                          manually, so treat a live re-delivery as a duplicate rather than silently
  //                          reprocessing it (which would resurrect the row into the sweep and churn
  //                          its critical alert) — and never advance it back into a retryable state
  //   failed               → a prior attempt finished with an error; reclaim so a retry reprocesses
  //   received + recent    → a concurrent delivery is in-flight; skip to avoid PARALLEL double-processing
  //   received + stale     → the prior worker likely crashed mid-process; reclaim (dead-letter sweep also covers this)
  const { data } = await supabase
    .from('webhook_events')
    .select('status, received_at')
    .eq('id', ev.id)
    .maybeSingle();
  const row = data as { status: string; received_at: string } | null;
  if (!row) return 'claimed'; // row vanished between insert and lookup — safe to (re)claim
  if (row.status === 'processed') return 'duplicate';
  if (row.status === 'dead') return 'duplicate';
  if (row.status === 'failed') return 'claimed';

  // status === 'received'
  const ageMs = Date.now() - new Date(row.received_at).getTime();
  return Number.isFinite(ageMs) && ageMs < IN_FLIGHT_WINDOW_MS ? 'duplicate' : 'claimed';
}

export async function markWebhookProcessed(supabase: SupabaseClient, id: string): Promise<void> {
  // Throw on failure: if this write is silently dropped, the route would return 200 while the
  // row stays non-'processed', so the dead-letter sweep re-dispatches the event and duplicates
  // side effects. Throwing makes the route return 5xx → Stripe retries → re-claim → re-mark.
  const { error } = await supabase
    .from('webhook_events')
    .update({ status: 'processed', processed_at: new Date().toISOString(), error: null })
    .eq('id', id);
  if (error) {
    throw new Error(`markWebhookProcessed: failed to mark ${id} processed (${error.code ?? 'unknown'}): ${error.message}`);
  }
}

export async function markWebhookFailed(
  supabase: SupabaseClient,
  id: string,
  error: string,
  opts: { retryCount?: number } = {},
): Promise<void> {
  // Best-effort (already on the failure path). If even this write fails the row stays in its
  // prior non-'processed' state, so the reconciliation sweep remains the backstop — just log.
  // `retryCount` is set by the dead-letter sweep (T1-10) to persist how many times IT has retried;
  // the live webhook path omits it (Stripe still retries live deliveries, which don't count toward
  // the give-up cap). retry_count is only ever advanced by the single serialized sweep, so a plain
  // write (not an atomic increment) is race-free.
  const patch: Record<string, unknown> = { status: 'failed', error: error.slice(0, 2000) };
  if (opts.retryCount != null) patch.retry_count = opts.retryCount;
  const { error: updateError } = await supabase.from('webhook_events').update(patch).eq('id', id);
  if (updateError) console.error('markWebhookFailed: failed to record failure for', id, updateError.message);
}

/**
 * Terminalize a webhook_events row the dead-letter sweep has given up on (T1-10). A `dead` row is
 * excluded from the sweep's retry selection so a permanently-unrecoverable event (e.g. an event on a
 * detached Connect account) can never starve the ascending-FIFO batch. The caller raises a critical
 * platform alert alongside this, because a dead Connect event (a payout failure, a reversal) is money
 * state we could not process and a human must replay or handle it manually.
 */
export async function markWebhookDead(
  supabase: SupabaseClient,
  id: string,
  error: string,
  retryCount: number,
): Promise<void> {
  const { error: updateError } = await supabase
    .from('webhook_events')
    .update({ status: 'dead', error: error.slice(0, 2000), retry_count: retryCount })
    .eq('id', id);
  if (updateError) console.error('markWebhookDead: failed to mark', id, 'dead', updateError.message);
}
