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
  | 'cleaner_counter_accepted'      // recipient: cleaner (admin accepted their proposed time)
  | 'appointment_rescheduled'       // recipient: cleaner (moved to a new time; payload.requires_confirmation: re-confirm ask vs FYI)
  | 'cleaner_accepted'              // recipient: homeowner + admins
  | 'cleaner_declined'              // recipient: admins
  | 'cleaner_counter_proposed'      // recipient: admins (one-click accept available)
  | 'chain_exhausted'               // recipient: admins (urgent, force-assign required)
  | 'cleaner_response_overdue'      // recipient: admins (SLA elapsed)
  | 'cleaner_paid'                  // recipient: cleaner (payout settled / bank_paid)
  | 'cleaner_payout_bank_failed'    // recipient: cleaner + admins (bank-level payout failed after transfer; bank details need fixing)
  | 'job_started'                   // recipient: homeowner + admins
  | 'job_completed'                 // recipient: homeowner + admins
  | 'dispute_opened'                // recipient: admins (chargeback created)
  | 'authorization_failed'          // recipient: admins (card hold declined)
  | 'authentication_required'       // recipient: admins + homeowner (3-D Secure needed on the hold)
  | 'charge_failed'                 // recipient: admins (completion charge declined / needs 3DS / no card on file)
  | 'cancellation_fee_failed'       // recipient: admins (cancel fee uncollectable or declined)
  | 'self_pay_no_card'              // recipient: admins (self-pay completion, no company card)
  | 'tenant_payments_not_ready'     // recipient: admins (completion charge blocked: org Stripe account can't accept charges)
  | 'cleaner_not_payable'           // recipient: admins (self-pay charge blocked: cleaner payout setup incomplete)
  | 'cancelled_job_refunded'        // recipient: admins (in-flight debit auto-refunded after cancel)
  | 'refund_failed'                 // recipient: admins (a refund failed/canceled at Stripe; payer not refunded)
  | 'clawback_blocked'              // recipient: admins (payout already bank_paid; recovery needs an ops decision)
  | 'job_message'                   // recipient: counterparty (homeowner or cleaner) on a job thread
  | 'appointment_time_changed'      // recipient: homeowner (operator moved the time and it is settled)
  | 'member_joined';                // recipient: admins + managers (someone accepted an invite and joined the org)

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
  /** Most events are about an appointment; org-level events (e.g. member_joined) have none. */
  appointment_id?: string | null;
  organization_id: string;
  /**
   * Explicit recipient. If omitted, the helper fans out to the org members
   * whose role is in `recipient_roles` (one row each). Use the explicit field
   * for cleaner / homeowner events.
   */
  recipient_user_id?: string;
  /**
   * When fanning out (no `recipient_user_id`), which org-member roles receive
   * the event. Defaults to owners + admins. Pass e.g. ['owner','admin','manager']
   * to include managers.
   */
  recipient_roles?: string[];
  /** User ids to drop from a fan-out (e.g. the actor who triggered the event). */
  exclude_user_ids?: string[];
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
