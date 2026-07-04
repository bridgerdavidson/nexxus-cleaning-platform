import type { SupabaseClient } from '@supabase/supabase-js';
import { advanceAppointmentRouting } from './advanceRouting';
import { recordNotificationEvent } from '../notifications/recordEvent';
import { loadNotificationContext } from '../notifications/context';

/**
 * Shared per-appointment accept / decline commit for the SIMPLE offer case:
 * admin-direct single-slot occurrences (no homeowner-request multi-slot, no
 * request_state, no counter-propose). This mirrors the accept / decline paths of
 * `src/app/api/appointments/confirm/route.ts` for that case so the bulk
 * series route (`/api/appointments/confirm-series`) produces identical outcomes
 * per occurrence. The production confirm route is intentionally NOT refactored
 * onto these helpers yet (its multi-slot + counter-propose branches make that a
 * riskier change); that migration is a follow-up. Keep the two in sync.
 */

export interface OfferAppointment {
  id: string;
  status: string;
  homeowner_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
}

/** Accept an offered occurrence for this cleaner: approve + confirm, clear the SLA
 *  deadline, close any pending routing_log row, and notify the homeowner + admins. */
export async function commitAcceptOffer(
  admin: SupabaseClient,
  { appointment, cleanerId, organizationId }: {
    appointment: OfferAppointment;
    cleanerId: string;
    organizationId: string;
  },
): Promise<void> {
  const baseUpdate: Record<string, unknown> = {
    cleaner_confirmation_status: 'approved',
    response_deadline: null,
  };
  if (appointment.status === 'pending') baseUpdate.status = 'confirmed';

  const { error } = await admin.from('appointments').update(baseUpdate).eq('id', appointment.id);
  if (error) throw new Error(error.message);

  // Recurring occurrences usually have no routing_log row (created only after a
  // decline), so this is normally a no-op; close it when present so the
  // auto-defer sweep never re-routes an accepted occurrence.
  const { data: pendingLog } = await admin
    .from('appointment_routing_log')
    .select('id')
    .eq('appointment_id', appointment.id)
    .eq('response', 'pending')
    .order('attempt_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if ((pendingLog as { id?: string } | null)?.id) {
    await admin
      .from('appointment_routing_log')
      .update({ response: 'accepted', responded_at: new Date().toISOString(), slot_index_chosen: null })
      .eq('id', (pendingLog as { id: string }).id);
  }

  const ctx = await loadNotificationContext(admin, { appointmentId: appointment.id, cleanerId });
  if (appointment.homeowner_id) {
    await recordNotificationEvent(admin, {
      event_type: 'cleaner_accepted',
      appointment_id: appointment.id,
      organization_id: organizationId,
      recipient_user_id: appointment.homeowner_id,
      payload: {
        ...ctx,
        audience: 'homeowner',
        scheduled_date: appointment.scheduled_date,
        scheduled_time: appointment.scheduled_time,
      },
    });
  }
  await recordNotificationEvent(admin, {
    event_type: 'cleaner_accepted',
    appointment_id: appointment.id,
    organization_id: organizationId,
    payload: {
      ...ctx,
      audience: 'admin',
      scheduled_date: appointment.scheduled_date,
      scheduled_time: appointment.scheduled_time,
    },
  });
}

/** Decline an offered occurrence for this cleaner: clear the deadline, write the
 *  feedback reason, record a declined routing_log row, advance routing (so THIS
 *  occurrence re-routes independently), and notify admins. */
export async function commitDeclineOffer(
  admin: SupabaseClient,
  { appointment, cleanerId, organizationId, reasonText }: {
    appointment: OfferAppointment;
    cleanerId: string;
    organizationId: string;
    reasonText: string | null;
  },
): Promise<{ routingOutcome: string }> {
  const rejectPayload: Record<string, unknown> = { response_deadline: null };
  if (appointment.status === 'confirmed') rejectPayload.status = 'pending';
  // decline does NOT set cleaner_confirmation_status here; advanceAppointmentRouting
  // writes the final state atomically (reassigned or escalated).
  const { error: rejErr } = await admin.from('appointments').update(rejectPayload).eq('id', appointment.id);
  if (rejErr) throw new Error(rejErr.message);

  // Only the latest feedback should show. Delete is best-effort (matches the confirm route).
  await admin.from('cleaner_availability_feedback').delete().eq('appointment_id', appointment.id);
  const { error: feedbackError } = await admin.from('cleaner_availability_feedback').insert({
    appointment_id: appointment.id,
    cleaner_id: cleanerId,
    reason: reasonText,
  });
  // Deliberately non-fatal here (the single confirm route 500s instead): the forensic
  // feedback row is best-effort so one insert failure never strands the occurrence
  // before routing. Log it so the failure is visible, then continue to re-route.
  if (feedbackError) {
    console.error(`commitDeclineOffer: feedback insert failed for ${appointment.id}:`, feedbackError.message);
  }

  const nowIso = new Date().toISOString();
  const { data: pendingLog } = await admin
    .from('appointment_routing_log')
    .select('id')
    .eq('appointment_id', appointment.id)
    .eq('response', 'pending')
    .order('attempt_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  if ((pendingLog as { id?: string } | null)?.id) {
    await admin
      .from('appointment_routing_log')
      .update({ response: 'declined', responded_at: nowIso, decline_reason: reasonText })
      .eq('id', (pendingLog as { id: string }).id);
  } else {
    const { data: lastLog } = await admin
      .from('appointment_routing_log')
      .select('attempt_index')
      .eq('appointment_id', appointment.id)
      .order('attempt_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    const attemptIndex = ((lastLog as { attempt_index?: number } | null)?.attempt_index ?? 0) + 1;
    await admin.from('appointment_routing_log').insert({
      appointment_id: appointment.id,
      cleaner_id: cleanerId,
      attempt_index: attemptIndex,
      response: 'declined',
      responded_at: nowIso,
      decline_reason: reasonText,
      deadline_at: nowIso,
    });
  }

  const outcome = await advanceAppointmentRouting({
    appointmentId: appointment.id,
    organizationId,
    supabaseAdmin: admin,
  });

  const nextCleanerId = outcome.kind === 'assigned' ? outcome.cleanerId : undefined;
  const ctx = await loadNotificationContext(admin, { appointmentId: appointment.id, cleanerId, nextCleanerId });
  await recordNotificationEvent(admin, {
    event_type: 'cleaner_declined',
    appointment_id: appointment.id,
    organization_id: organizationId,
    payload: { ...ctx, audience: 'admin', decline_reason: reasonText, routing_outcome: outcome.kind },
  });
  if (outcome.kind === 'escalated') {
    await recordNotificationEvent(admin, {
      event_type: 'chain_exhausted',
      appointment_id: appointment.id,
      organization_id: organizationId,
      payload: { ...ctx, audience: 'admin' },
    });
  }
  return { routingOutcome: outcome.kind };
}
