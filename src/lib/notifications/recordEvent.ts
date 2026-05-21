import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationEventPayload } from './eventTypes';

/**
 * Append one row per notification event. Failures are swallowed by the caller —
 * the outbox is a best-effort write, not a critical part of the API response.
 *
 * If `recipient_user_id` is set, exactly one row is inserted. If not, the
 * helper fans out to every admin/owner of `organization_id` (one row per
 * admin) so the future dispatcher doesn't need to join.
 *
 * Idempotency: this helper does NOT dedupe. Callers must avoid emitting the
 * same event twice for the same state transition (e.g. don't call from a
 * retry path).
 */
export async function recordNotificationEvent(
  supabaseAdmin: SupabaseClient,
  event: NotificationEventPayload,
): Promise<void> {
  const recipients = event.recipient_user_id
    ? [event.recipient_user_id]
    : await resolveOrgAdmins(supabaseAdmin, event.organization_id);

  if (recipients.length === 0) return;

  const rows = recipients.map((rid) => ({
    organization_id: event.organization_id,
    appointment_id: event.appointment_id,
    recipient_user_id: rid,
    event_type: event.event_type,
    payload: event.payload ?? {},
    send_after: event.send_after ?? new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin.from('notification_events').insert(rows);
  if (error) {
    console.error('Failed to record notification event:', event.event_type, error);
  }
}

async function resolveOrgAdmins(
  supabaseAdmin: SupabaseClient,
  orgId: string,
): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .in('role', ['owner', 'admin']);
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}
