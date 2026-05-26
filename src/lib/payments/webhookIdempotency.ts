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

  // Conflict on the id: only a *processed* row is a real duplicate; a 'received'/'failed' row
  // was a prior attempt that didn't finish — allow reprocessing (handlers are idempotent).
  const { data } = await supabase
    .from('webhook_events')
    .select('status')
    .eq('id', ev.id)
    .maybeSingle();
  const status = (data as { status: string } | null)?.status;
  return status === 'processed' ? 'duplicate' : 'claimed';
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
): Promise<void> {
  // Best-effort (already on the failure path). If even this write fails the row stays in its
  // prior non-'processed' state, so the reconciliation sweep remains the backstop — just log.
  const { error: updateError } = await supabase
    .from('webhook_events')
    .update({ status: 'failed', error: error.slice(0, 2000) })
    .eq('id', id);
  if (updateError) console.error('markWebhookFailed: failed to record failure for', id, updateError.message);
}
