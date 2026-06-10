import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Clears a FAILED card authorization when an appointment switches to a bank (ACH) for recovery.
 *
 * A bank is charged at completion and has no hold, so a previously-failed card auth has nothing left
 * to fix: drop it out of "Payments needing attention" by clearing `authorization_status`, and reset
 * the stale failed revenue row to pending so the payment pill isn't stuck on "Failed" while the bank
 * is queued. No-op unless the appointment was actually `failed`/`requires_action` (so a normal bank
 * booking, or a repeat, doesn't thrash state).
 */
export async function clearFailedForBank(
  supabase: SupabaseClient,
  appt: { id: string; authorization_status: string | null },
): Promise<void> {
  if (appt.authorization_status !== 'failed' && appt.authorization_status !== 'requires_action') return;

  await supabase.from('appointments').update({ authorization_status: null }).eq('id', appt.id);
  await supabase
    .from('payments')
    .update({
      status: 'pending',
      stripe_payment_intent_id: null,
      payment_intent_status: null,
      authorized_at: null,
    })
    .eq('appointment_id', appt.id)
    .eq('payment_type', 'revenue')
    .eq('status', 'failed');
}
