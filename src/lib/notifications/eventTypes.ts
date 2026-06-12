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
  | 'cleaner_response_overdue'      // recipient: admins (SLA elapsed)
  | 'cleaner_paid'                  // recipient: cleaner (payout settled / bank_paid)
  | 'job_started'                   // recipient: homeowner + admins
  | 'job_completed'                 // recipient: homeowner + admins
  | 'dispute_opened'                // recipient: admins (chargeback created)
  | 'authorization_failed'          // recipient: admins (card hold declined)
  | 'authentication_required'       // recipient: admins + homeowner (3-D Secure needed on the hold)
  | 'charge_failed'                 // recipient: admins (completion charge declined / needs 3DS)
  | 'cancellation_fee_failed'       // recipient: admins (cancel fee uncollectable or declined)
  | 'self_pay_no_card'              // recipient: admins (self-pay completion, no company card)
  | 'cancelled_job_refunded';       // recipient: admins (in-flight debit auto-refunded after cancel)

/** Which audience a row is worded for (the row itself doesn't store the role). */
export type NotificationAudience = 'admin' | 'cleaner' | 'homeowner';

/**
 * Denormalized display context written into a notification's `payload` at emit
 * time so the in-app label (and a future SMS/email dispatcher) can render names
 * without any join. Every field is optional: the label builder falls back to
 * generic copy when one is missing, so historical rows stay readable.
 */
export interface NotificationContext {
  audience?: NotificationAudience;
  customer_name?: string;       // homeowner, or the org name for self-pay
  cleaner_name?: string;        // the primary cleaner the message is about
  next_cleaner_name?: string;   // reassignment target on a decline
  property_label?: string;
  scheduled_date?: string;      // YYYY-MM-DD
  scheduled_time?: string;      // HH:mm
}

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
  /**
   * Idempotency key for webhook/sweep-driven events. When set, a re-emit with the
   * same key for the same recipient is silently dropped (unique index, migration
   * 088) so a reprocessed Stripe event or a reconcile retry can't double-notify.
   */
  dedupe_key?: string;
}
