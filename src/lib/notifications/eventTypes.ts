/**
 * The catalog of notification events written to the `notification_events`
 * outbox. Today only in-app realtime listeners read these; tomorrow an SMS
 * dispatcher reads the same rows.
 *
 * Each event_type implies a recipient:
 *   - admin events: recipient_user_id = each admin/owner of the org
 *     (resolved at write time, one row per admin)
 *   - cleaner events: recipient_user_id = the assigned cleaner
 *   - homeowner events: recipient_user_id = the homeowner
 */
export type NotificationEventType =
  | 'homeowner_request_submitted'  // recipient: admins
  | 'cleaner_assigned'              // recipient: cleaner
  | 'cleaner_force_assigned'        // recipient: cleaner (no confirmation needed)
  | 'cleaner_accepted'              // recipient: homeowner + admins
  | 'cleaner_declined'              // recipient: admins
  | 'cleaner_counter_proposed'      // recipient: admins (one-click accept available)
  | 'chain_exhausted'               // recipient: admins (urgent, force-assign required)
  | 'cleaner_response_overdue';     // recipient: admins (SLA elapsed)

export interface NotificationEventPayload {
  event_type: NotificationEventType;
  appointment_id: string;
  organization_id: string;
  /**
   * Explicit recipient. If omitted, the helper fans out to all admins of the
   * organization (one row per admin). Use the explicit field for cleaner /
   * homeowner events.
   */
  recipient_user_id?: string;
  /** Arbitrary extra data. Stored as JSONB. */
  payload?: Record<string, unknown>;
  /** ISO timestamp for scheduled/deferred events (e.g. deadline reminders). */
  send_after?: string;
}
