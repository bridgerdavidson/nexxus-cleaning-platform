import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { declineReasonLabel, type DeclineReason } from '@/types';
import { advanceAppointmentRouting } from '@/lib/appointments/advanceRouting';
import {
  canCounterPropose,
  usesRequestState,
} from '@/lib/appointments/flowType';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

// Confirming does several Supabase reads + notification writes, which can run past the default
// function cap under production latency. Headroom prevents a 504.
export const maxDuration = 60;

type ConfirmAction = 'accept' | 'counter_propose' | 'decline';

interface ConfirmAppointmentInput {
  appointmentId: string;
  /** Preferred explicit action. Wave 1+: one of 'accept' | 'counter_propose' | 'decline'. */
  action?: ConfirmAction;
  /**
   * @deprecated Use `action` instead. Kept for backward-compat with old clients:
   * true → accept, false → counter_propose.
   */
  confirmed?: boolean;
  /** Required when action === 'decline'. */
  declineReason?: DeclineReason;
  /** Free-text supplement when declineReason === 'other'. */
  declineReasonOther?: string;
  organizationId: string;
  /**
   * Required on accept when the appointment is homeowner_initiated AND has
   * more than one offered slot. 0 = primary, 1..2 = alternates.
   */
  slotIndex?: number;
  feedback?: {
    reason: string;
    suggestedTimes?: { date: string; time: string }[];
    suggestedWindows?: { date: string; startTime: string; endTime: string }[];
  };
}

function resolveAction(input: ConfirmAppointmentInput): ConfirmAction | null {
  if (input.action) return input.action;
  if (input.confirmed === true) return 'accept';
  if (input.confirmed === false) return 'counter_propose';
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body: ConfirmAppointmentInput = await request.json();
    const { appointmentId, organizationId, feedback } = body;
    const action = resolveAction(body);

    if (!appointmentId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: appointmentId, organizationId' },
        { status: 400 }
      );
    }
    if (!action) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: action (or legacy `confirmed`)' },
        { status: 400 }
      );
    }

    // ── Auth: caller must be a cleaner (or admin) in this org. The verified
    //     userId from the token is what we use as cleanerId — never trust
    //     the body for caller identity. ─────────────────────────────────────
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['cleaner', 'admin', 'owner', 'manager'],
    });
    if (!auth.ok) return auth.response;
    const cleanerId = auth.userId;

    // Verify the appointment belongs to this org AND this cleaner.
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, cleaner_id, homeowner_id, scheduled_date, scheduled_time, organization_id, service_type_id, status, homeowner_initiated, flow_type, request_state, payment_method_id, is_self_pay, updated_at')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .single();

    if (appointmentError || !appointment) {
      return NextResponse.json(
        { success: false, error: 'Appointment not found' },
        { status: 404 }
      );
    }

    if (appointment.cleaner_id !== cleanerId) {
      return NextResponse.json(
        { success: false, error: 'This appointment is not assigned to you' },
        { status: 403 }
      );
    }

    if (action === 'accept') {
      // For multi-slot requests (homeowner-initiated OR admin-direct with alts),
      // copy the cleaner's chosen slot into the appointment row before flipping
      // to confirmed. Admin-direct flow always has a primary; alternates land
      // in appointment_requested_slots when admin filled them at create time.
      let acceptedDate = appointment.scheduled_date as string;
      let acceptedTime = appointment.scheduled_time as string;
      let acceptedSlotIndex: number | null = null;

      const { data: slotRows } = await supabaseAdmin
        .from('appointment_requested_slots')
        .select('slot_index, scheduled_date, scheduled_time')
        .eq('appointment_id', appointmentId)
        .order('slot_index', { ascending: true });
      const slots = (slotRows ?? []) as Array<{
        slot_index: number;
        scheduled_date: string;
        scheduled_time: string;
      }>;
      // The redesign shell always sends slotIndex; for a booking with no slot
      // rows offeredSlots() synthesizes a single slot_index 0, so 0 (or no
      // slotIndex) with zero rows means "accept the appointment row as-is".
      // Anything else points at an offered slot that no longer exists (e.g. an
      // operator reschedule deleted the rows) — reject instead of silently
      // confirming the cleaner onto a time they never saw.
      if (slots.length === 0 && body.slotIndex !== undefined && body.slotIndex !== 0) {
        return NextResponse.json(
          { success: false, stale: true, error: 'This job changed while you were responding. Refresh and try again.' },
          { status: 409 },
        );
      }
      if (slots.length > 1) {
        if (body.slotIndex === undefined) {
          return NextResponse.json(
            { success: false, error: 'slotIndex is required when accepting a multi-slot request' },
            { status: 400 },
          );
        }
        const chosen = slots.find((s) => s.slot_index === body.slotIndex);
        if (!chosen) {
          return NextResponse.json(
            { success: false, stale: true, error: 'This job changed while you were responding. Refresh and try again.' },
            { status: 409 },
          );
        }
        acceptedDate = chosen.scheduled_date;
        acceptedTime = chosen.scheduled_time;
        acceptedSlotIndex = chosen.slot_index;
      } else if (usesRequestState(appointment) && slots.length === 1) {
        // Single-slot homeowner request — still pull the canonical time from
        // the slot row so the appointment matches what the homeowner offered.
        acceptedDate = slots[0].scheduled_date;
        acceptedTime = slots[0].scheduled_time;
        acceptedSlotIndex = slots[0].slot_index;
      }

      // SLA stops once the cleaner has responded — clear the deadline so the
      // admin overdue surface drops this appointment.
      const baseUpdate = {
        cleaner_confirmation_status: 'approved',
        response_deadline: null,
      } as Record<string, unknown>;
      if (appointment.status === 'pending') {
        baseUpdate.status = 'confirmed';
      }
      if (acceptedSlotIndex !== null) {
        baseUpdate.scheduled_date = acceptedDate;
        baseUpdate.scheduled_time = acceptedTime;
      }
      if (usesRequestState(appointment)) {
        baseUpdate.request_state = 'completed';
      }

      // Conditional on the updated_at read above so a stale accept can't clobber
      // an operator reschedule that landed on this appointment in the meantime
      // (the reschedule route always bumps updated_at). Zero rows updated means
      // someone else changed the row first.
      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from('appointments')
        .update(baseUpdate)
        .eq('id', appointmentId)
        .eq('updated_at', appointment.updated_at as string)
        .select('id');

      if (updateError) {
        console.error('Error confirming appointment:', updateError);
        return NextResponse.json(
          { success: false, error: 'Failed to confirm appointment' },
          { status: 500 }
        );
      }
      if (!updatedRows || updatedRows.length === 0) {
        return NextResponse.json(
          { success: false, stale: true, error: 'This job changed while you were responding. Refresh and try again.' },
          { status: 409 },
        );
      }

      // Mark the latest pending routing_log row (if any) as accepted. This
      // runs for every flow type, not just homeowner_request: admin_direct
      // appointments also accrue routing_log rows after a cleaner decline
      // (since fe71ea8 routes admin_direct through the chain too), so if we
      // skipped them here the row would stay `pending` and the auto-defer
      // sweep would later flip it to `expired` and re-route an
      // already-accepted appointment.
      //
      // Single-slot admin_direct that never saw a decline has no pending row,
      // so maybeSingle returns null and we no-op.
      const { data: pendingLog } = await supabaseAdmin
        .from('appointment_routing_log')
        .select('id')
        .eq('appointment_id', appointmentId)
        .eq('response', 'pending')
        .order('attempt_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pendingLog?.id) {
        await supabaseAdmin
          .from('appointment_routing_log')
          .update({
            response: 'accepted',
            responded_at: new Date().toISOString(),
            slot_index_chosen: acceptedSlotIndex,
          })
          .eq('id', pendingLog.id);
      }

      // Notify both the homeowner (their appointment is confirmed) and admins.
      // The responding cleaner is the one accepting; enrich with their name +
      // property so each audience gets a descriptive line.
      const acceptCtx = await loadNotificationContext(supabaseAdmin, {
        appointmentId,
        cleanerId,
      });
      if (appointment.homeowner_id) {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: 'cleaner_accepted',
          appointment_id: appointmentId,
          organization_id: organizationId,
          recipient_user_id: appointment.homeowner_id as string,
          payload: {
            ...acceptCtx,
            audience: 'homeowner',
            scheduled_date: acceptedDate,
            scheduled_time: acceptedTime,
          },
        });
      }
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_accepted',
        appointment_id: appointmentId,
        organization_id: organizationId,
        // null recipient → fans out to all admins
        payload: {
          ...acceptCtx,
          audience: 'admin',
          scheduled_date: acceptedDate,
          scheduled_time: acceptedTime,
        },
      });

      return NextResponse.json({ success: true, message: 'Appointment confirmed successfully' });
    }

    if (action === 'counter_propose' && !canCounterPropose(appointment)) {
      return NextResponse.json(
        { success: false, error: 'Counter-proposing is not allowed on homeowner-initiated requests' },
        { status: 400 },
      );
    }

    // ===== CLEANER DID NOT ACCEPT =====
    // `counter_propose` (legacy `confirmed: false`) writes feedback + suggested times/windows.
    // `decline` writes feedback with a canned reason and NO suggested rows. Both flip
    // cleaner_confirmation_status to 'rejected'; the admin UI distinguishes the two by
    // whether suggested-times rows exist (counter-proposed vs hard decline).
    //
    // For counter-proposals the cleaner doesn't have to explain — the alternative
    // times speak for themselves. Reason is stored as null when not provided so the
    // admin UI can hide the "Reason" sub-section cleanly.
    let reasonText: string | null;
    if (action === 'counter_propose') {
      reasonText = feedback?.reason?.trim() ? feedback.reason.trim() : null;
    } else {
      // action === 'decline'
      if (!body.declineReason) {
        return NextResponse.json(
          { success: false, error: 'declineReason is required when declining' },
          { status: 400 }
        );
      }
      const allowed: DeclineReason[] = ['sick', 'not_available', 'not_my_service', 'too_far', 'other'];
      if (!allowed.includes(body.declineReason)) {
        return NextResponse.json(
          { success: false, error: 'declineReason must be one of: sick | not_available | not_my_service | too_far | other' },
          { status: 400 }
        );
      }
      const label = declineReasonLabel(body.declineReason);
      reasonText =
        body.declineReason === 'other' && body.declineReasonOther?.trim()
          ? `${label}: ${body.declineReasonOther.trim()}`
          : label;
    }

    // SLA stops once the cleaner has responded — clear the deadline.
    //
    // Decline paths skip the legacy 'rejected' write so the appointment
    // doesn't briefly surface in ActionRequiredSection while we route to
    // the next cleaner. advanceAppointmentRouting (called below) writes the
    // final state atomically — either reassigned (cleaner_id=new,
    // status='awaiting') or escalated (cleaner_id=null + state surfaces in
    // ActionRequiredSection).
    //
    // Counter-proposals don't auto-reassign — they stay rejected so the admin
    // can accept the proposed times in ActionRequiredSection.
    const rejectPayload: Record<string, unknown> = {
      response_deadline: null,
    };
    if (appointment.status === 'confirmed') {
      rejectPayload.status = 'pending';
    }
    if (action === 'counter_propose') {
      rejectPayload.cleaner_confirmation_status = 'rejected';
    }

    // Same updated_at guard as the accept branch: without it a stale
    // counter-propose/decline could land after (and flip back) an operator
    // reschedule or an already-processed auto-approve on this appointment.
    const { data: rejectedRows, error: rejectError } = await supabaseAdmin
      .from('appointments')
      .update(rejectPayload)
      .eq('id', appointmentId)
      .eq('updated_at', appointment.updated_at as string)
      .select('id');

    if (rejectError) {
      console.error('Error rejecting appointment:', rejectError);
      return NextResponse.json(
        { success: false, error: 'Failed to update appointment status' },
        { status: 500 }
      );
    }
    if (!rejectedRows || rejectedRows.length === 0) {
      return NextResponse.json(
        { success: false, stale: true, error: 'This job changed while you were responding. Refresh and try again.' },
        { status: 409 },
      );
    }

    // Delete prior feedback so only the latest entry shows.
    try {
      await supabaseAdmin
        .from('cleaner_availability_feedback')
        .delete()
        .eq('appointment_id', appointmentId);
    } catch (deleteErr) {
      console.error('Error deleting old feedback:', deleteErr);
    }

    const { data: feedbackData, error: feedbackError } = await supabaseAdmin
      .from('cleaner_availability_feedback')
      .insert({
        appointment_id: appointmentId,
        cleaner_id: cleanerId,
        reason: reasonText,
      })
      .select()
      .single();

    if (feedbackError || !feedbackData) {
      console.error('Error inserting feedback:', feedbackError);
      return NextResponse.json(
        { success: false, error: 'Failed to save feedback' },
        { status: 500 }
      );
    }

    // Suggested times/windows only apply to counter-proposals; declines never write them.
    // Capture the first inserted suggested-time row so the admin can one-click
    // accept it straight from the notification bell.
    let primarySuggestedTime:
      | { id: string; suggested_date: string; suggested_time: string }
      | null = null;
    if (action === 'counter_propose' && feedback?.suggestedTimes && feedback.suggestedTimes.length > 0) {
      const suggestedTimeRows = feedback.suggestedTimes.map((st) => ({
        feedback_id: (feedbackData as { id: string }).id,
        suggested_date: st.date,
        suggested_time: st.time,
      }));
      const { data: insertedTimes, error: timesError } = await supabaseAdmin
        .from('cleaner_suggested_times')
        .insert(suggestedTimeRows)
        .select('id, suggested_date, suggested_time');
      if (timesError) console.error('Error inserting suggested times:', timesError);
      const rows = (insertedTimes ?? []) as Array<{
        id: string;
        suggested_date: string;
        suggested_time: string;
      }>;
      if (rows.length > 0) primarySuggestedTime = rows[0];
    }

    if (action === 'counter_propose' && feedback?.suggestedWindows && feedback.suggestedWindows.length > 0) {
      const suggestedWindowRows = feedback.suggestedWindows.map((sw) => ({
        feedback_id: (feedbackData as { id: string }).id,
        window_date: sw.date,
        start_time: sw.startTime,
        end_time: sw.endTime,
      }));
      const { error: windowsError } = await supabaseAdmin
        .from('cleaner_suggested_windows')
        .insert(suggestedWindowRows);
      if (windowsError) console.error('Error inserting suggested windows:', windowsError);
    }

    // Decline auto-reassigns to the next cleaner regardless of how the
    // appointment was created. Homeowner-initiated requests already have a
    // pending routing_log row from assign-cleaner — close it. Admin-direct
    // appointments have no log row; insert one so advanceAppointmentRouting
    // (which derives the chain from the log) treats this cleaner as
    // already-attempted and won't re-pick them.
    let routingOutcome: string | null = null;
    if (action === 'decline') {
      const { data: pendingLog } = await supabaseAdmin
        .from('appointment_routing_log')
        .select('id')
        .eq('appointment_id', appointmentId)
        .eq('response', 'pending')
        .order('attempt_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pendingLog?.id) {
        await supabaseAdmin
          .from('appointment_routing_log')
          .update({
            response: 'declined',
            responded_at: new Date().toISOString(),
            decline_reason: reasonText,
          })
          .eq('id', pendingLog.id);
      } else {
        const { data: lastLog } = await supabaseAdmin
          .from('appointment_routing_log')
          .select('attempt_index')
          .eq('appointment_id', appointmentId)
          .order('attempt_index', { ascending: false })
          .limit(1)
          .maybeSingle();
        const attemptIndex =
          ((lastLog as { attempt_index?: number } | null)?.attempt_index ?? 0) + 1;
        const nowIso = new Date().toISOString();
        await supabaseAdmin.from('appointment_routing_log').insert({
          appointment_id: appointmentId,
          cleaner_id: cleanerId,
          attempt_index: attemptIndex,
          response: 'declined',
          responded_at: nowIso,
          decline_reason: reasonText,
          deadline_at: nowIso,
        });
      }
      const outcome = await advanceAppointmentRouting({
        appointmentId,
        organizationId,
        supabaseAdmin,
      });
      routingOutcome = outcome.kind;

      // Decline event always fires; if the chain exhausts we also emit a
      // chain_exhausted urgent signal. Enrich with the decliner's name and the
      // reassignment target (when the chain advanced to another cleaner).
      const nextCleanerId = outcome.kind === 'assigned' ? outcome.cleanerId : undefined;
      const declineCtx = await loadNotificationContext(supabaseAdmin, {
        appointmentId,
        cleanerId,
        nextCleanerId,
      });
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_declined',
        appointment_id: appointmentId,
        organization_id: organizationId,
        payload: {
          ...declineCtx,
          audience: 'admin',
          decline_reason: reasonText,
          routing_outcome: outcome.kind,
        },
      });
      if (outcome.kind === 'escalated') {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: 'chain_exhausted',
          appointment_id: appointmentId,
          organization_id: organizationId,
          payload: { ...declineCtx, audience: 'admin' },
        });
      }
    } else if (action === 'counter_propose') {
      const counterCtx = await loadNotificationContext(supabaseAdmin, {
        appointmentId,
        cleanerId,
      });
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_counter_proposed',
        appointment_id: appointmentId,
        organization_id: organizationId,
        payload: {
          ...counterCtx,
          audience: 'admin',
          suggested_times_count: feedback?.suggestedTimes?.length ?? 0,
          suggested_windows_count: feedback?.suggestedWindows?.length ?? 0,
          // Enables the bell's one-click "Accept {date} {time}" button.
          suggested_time_id: primarySuggestedTime?.id,
          suggested_date: primarySuggestedTime?.suggested_date,
          suggested_time: primarySuggestedTime?.suggested_time,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: action === 'decline' ? 'Decline recorded' : 'Counter-proposal submitted',
      feedbackId: (feedbackData as { id: string }).id,
      routingOutcome,
    });
  } catch (error) {
    console.error('Error in appointment confirm POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const appointmentId = searchParams.get('appointmentId');

    if (!appointmentId) {
      return NextResponse.json(
        { success: false, error: 'appointmentId is required' },
        { status: 400 }
      );
    }

    const { data: feedback, error: feedbackError } = await supabaseAdmin
      .from('cleaner_availability_feedback')
      .select(`
        *,
        cleaner_suggested_times (*),
        cleaner_suggested_windows (*)
      `)
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false });

    if (feedbackError) {
      console.error('Error fetching feedback:', feedbackError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch feedback' },
        { status: 500 }
      );
    }

    // Surface the latest routing_log row so the reschedule modal can show the
    // correct copy when an appointment times out (response='expired') instead
    // of silently falling back to a feedback row that doesn't exist.
    const { data: latestRoutingRow } = await supabaseAdmin
      .from('appointment_routing_log')
      .select('response, decline_reason, responded_at, attempt_index')
      .eq('appointment_id', appointmentId)
      .order('attempt_index', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      data: feedback || [],
      latestRouting: latestRoutingRow ?? null,
    });
  } catch (error) {
    console.error('Error in appointment confirm GET:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
