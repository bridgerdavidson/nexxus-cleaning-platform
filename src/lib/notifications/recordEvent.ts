import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationEventPayload } from './eventTypes';

/**
 * Append one row per notification event. The outbox is a best-effort write —
 * callers do not need to wrap this call in try/catch. Any failure (DB error,
 * malformed client, missing table) is logged and swallowed here so a broken
 * notification path never crashes the API route that triggered it.
 *
 * If `recipient_user_id` is set, exactly one row is inserted. If not, the
 * helper fans out to every admin/owner of `organization_id` (one row per
 * admin) so the future dispatcher doesn't need to join.
 *
 * Idempotency: by default this helper does NOT dedupe — callers must avoid
 * emitting the same event twice for the same state transition. Webhook/sweep
 * call sites (which CAN legitimately re-run) should pass `dedupe_key`: a
 * re-emit with the same key for the same recipient is silently dropped
 * (unique index on (recipient_user_id, dedupe_key), migration 088).
 */
export async function recordNotificationEvent(
  supabaseAdmin: SupabaseClient,
  event: NotificationEventPayload,
): Promise<void> {
  try {
    const resolved = event.recipient_user_id
      ? [event.recipient_user_id]
      : await resolveOrgMembers(
          supabaseAdmin,
          event.organization_id,
          event.recipient_roles ?? ['owner', 'admin'],
        );

    const recipients = event.exclude_user_ids?.length
      ? resolved.filter((id) => !event.exclude_user_ids!.includes(id))
      : resolved;

    if (recipients.length === 0) return;

    const rows = recipients.map((rid) => ({
      organization_id: event.organization_id,
      appointment_id: event.appointment_id ?? null,
      recipient_user_id: rid,
      event_type: event.event_type,
      payload: event.payload ?? {},
      send_after: event.send_after ?? new Date().toISOString(),
      ...(event.dedupe_key ? { dedupe_key: event.dedupe_key } : {}),
    }));

    const { error } = event.dedupe_key
      ? await supabaseAdmin
          .from('notification_events')
          .upsert(rows, { onConflict: 'recipient_user_id,dedupe_key', ignoreDuplicates: true })
      : await supabaseAdmin.from('notification_events').insert(rows);
    if (error) {
      console.error('Failed to record notification event:', event.event_type, error);
    }
  } catch (err) {
    console.error('Failed to record notification event (threw):', event.event_type, err);
  }
}

async function resolveOrgMembers(
  supabaseAdmin: SupabaseClient,
  orgId: string,
  roles: string[],
): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .in('role', roles);
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}
