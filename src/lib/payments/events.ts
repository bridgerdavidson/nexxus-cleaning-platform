/**
 * Append-only payment forensic ledger writer.
 *
 * Every payment state transition (and every Stripe event we act on) should write a
 * `payment_events` row so we always have an ordered, queryable history of what happened
 * to a payment — the answer to "we don't want payments going wrong and not knowing what
 * happened." Ledger writes are best-effort: a failure here must never break the money flow.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PaymentEventInput {
  paymentId?: string | null;
  appointmentId?: string | null;
  organizationId?: string | null;
  stripeEventId?: string | null;
  eventType: string;
  prevStatus?: string | null;
  newStatus?: string | null;
  /** system | webhook | reconciler | user:<id> */
  actor?: string | null;
  amount?: number | null;
  payload?: Record<string, unknown>;
}

export async function recordPaymentEvent(
  supabase: SupabaseClient,
  ev: PaymentEventInput,
): Promise<void> {
  const { error } = await supabase.from('payment_events').insert({
    payment_id: ev.paymentId ?? null,
    appointment_id: ev.appointmentId ?? null,
    organization_id: ev.organizationId ?? null,
    stripe_event_id: ev.stripeEventId ?? null,
    event_type: ev.eventType,
    prev_status: ev.prevStatus ?? null,
    new_status: ev.newStatus ?? null,
    actor: ev.actor ?? null,
    amount: ev.amount ?? null,
    payload: ev.payload ?? {},
  });

  if (error) {
    console.error('recordPaymentEvent: failed to write payment_events row:', error.message);
  }
}
