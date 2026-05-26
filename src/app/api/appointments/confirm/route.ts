import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { formatTimeTo12h } from '@/lib/formatTime';
import { declineReasonLabel, type DeclineReason } from '@/types';
import { advanceAppointmentRouting } from '@/lib/appointments/advanceRouting';
import {
  canCounterPropose,
  usesRequestState,
} from '@/lib/appointments/flowType';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { authorizeAppointment } from '@/lib/payments/authorizeAppointment';

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

function formatDateShort(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const twoDigitYear = year % 100;
  return `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${twoDigitYear.toString().padStart(2, '0')}`;
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
      .select('id, cleaner_id, homeowner_id, scheduled_date, scheduled_time, organization_id, service_type_id, status, homeowner_initiated, flow_type, request_state, payment_method_id')
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
            { success: false, error: 'slotIndex does not match an offered slot' },
            { status: 400 },
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

      const { error: updateError } = await supabaseAdmin
        .from('appointments')
        .update(baseUpdate)
        .eq('id', appointmentId);

      if (updateError) {
        console.error('Error confirming appointment:', updateError);
        return NextResponse.json(
          { success: false, error: 'Failed to confirm appointment' },
          { status: 500 }
        );
      }

      // Authorize-on-accept (decision #9): once the appointment is confirmed and the
      // homeowner saved a card at request time, place the manual-capture hold now. Best-effort
      // — a failure here (declined/tenant-not-ready) must NOT block the confirmation; the JIT
      // authorizer cron + the "payments needing attention" surface are the backstops.
      if (
        baseUpdate.status === 'confirmed' &&
        appointment.payment_method_id &&
        stripeEnabled() &&
        stripeNewChargeFlowEnabled()
      ) {
        try {
          const outcome = await authorizeAppointment(
            supabaseAdmin,
            appointmentId,
            'confirm:authorize-on-accept',
          );
          if (!outcome.ok) {
            console.warn(
              `Authorize-on-accept for ${appointmentId} returned ${outcome.code}: ${outcome.message ?? ''}`,
            );
          }
        } catch (authErr) {
          console.error('Authorize-on-accept failed (non-blocking):', authErr);
        }
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

      await sendMessageToAdmins({
        organizationId,
        senderId: cleanerId,
        appointmentId,
        content: `I've confirmed my availability for the appointment on ${formatDateShort(acceptedDate)} at ${formatTimeTo12h(acceptedTime)}. I'm ready to go!`,
      });

      // Notify both the homeowner (their appointment is confirmed) and admins.
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_accepted',
        appointment_id: appointmentId,
        organization_id: organizationId,
        recipient_user_id: appointment.homeowner_id as string,
        payload: { scheduled_date: acceptedDate, scheduled_time: acceptedTime },
      });
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_accepted',
        appointment_id: appointmentId,
        organization_id: organizationId,
        // null recipient → fans out to all admins
        payload: { scheduled_date: acceptedDate, scheduled_time: acceptedTime },
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
      const allowed: DeclineReason[] = ['sick', 'not_my_service', 'too_far', 'other'];
      if (!allowed.includes(body.declineReason)) {
        return NextResponse.json(
          { success: false, error: 'declineReason must be one of: sick | not_my_service | too_far | other' },
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

    const { error: rejectError } = await supabaseAdmin
      .from('appointments')
      .update(rejectPayload)
      .eq('id', appointmentId);

    if (rejectError) {
      console.error('Error rejecting appointment:', rejectError);
      return NextResponse.json(
        { success: false, error: 'Failed to update appointment status' },
        { status: 500 }
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
    if (action === 'counter_propose' && feedback?.suggestedTimes && feedback.suggestedTimes.length > 0) {
      const suggestedTimeRows = feedback.suggestedTimes.map((st) => ({
        feedback_id: (feedbackData as { id: string }).id,
        suggested_date: st.date,
        suggested_time: st.time,
      }));
      const { error: timesError } = await supabaseAdmin
        .from('cleaner_suggested_times')
        .insert(suggestedTimeRows);
      if (timesError) console.error('Error inserting suggested times:', timesError);
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

    let messageContent = `I'm not available for the appointment on ${formatDateShort(appointment.scheduled_date as string)} at ${formatTimeTo12h(appointment.scheduled_time as string)}.${
      reasonText ? `\n\nReason: ${reasonText}` : ''
    }`;
    if (action === 'counter_propose' && feedback?.suggestedTimes && feedback.suggestedTimes.length > 0) {
      messageContent += '\n\nSuggested alternative times:';
      feedback.suggestedTimes.forEach((st) => {
        messageContent += `\n- ${formatDateShort(st.date)} at ${formatTimeTo12h(st.time)}`;
      });
    }

    await sendMessageToAdmins({
      organizationId,
      senderId: cleanerId,
      appointmentId,
      content: messageContent,
    });

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
      // chain_exhausted urgent signal.
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_declined',
        appointment_id: appointmentId,
        organization_id: organizationId,
        payload: { decline_reason: reasonText, routing_outcome: outcome.kind },
      });
      if (outcome.kind === 'escalated') {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: 'chain_exhausted',
          appointment_id: appointmentId,
          organization_id: organizationId,
        });
      }
    } else if (action === 'counter_propose') {
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_counter_proposed',
        appointment_id: appointmentId,
        organization_id: organizationId,
        payload: {
          suggested_times_count: feedback?.suggestedTimes?.length ?? 0,
          suggested_windows_count: feedback?.suggestedWindows?.length ?? 0,
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

async function sendMessageToAdmins({
  organizationId,
  senderId,
  appointmentId,
  content,
}: {
  organizationId: string;
  senderId: string;
  appointmentId: string;
  content: string;
}) {
  try {
    const { data: adminMembers, error: membersError } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .in('role', ['owner', 'admin']);

    if (membersError || !adminMembers || adminMembers.length === 0) {
      console.error('Could not find admins for organization:', membersError);
      return;
    }

    for (const adminMember of adminMembers) {
      const memberUserId = (adminMember as { user_id: string }).user_id;
      if (memberUserId === senderId) continue;

      const { data: conversationId, error: convError } = await supabaseAdmin
        .rpc('get_or_create_conversation', {
          user1_id: senderId,
          user2_id: memberUserId,
        });

      if (convError || !conversationId) {
        console.error('Error getting/creating conversation:', convError);
        continue;
      }

      const { error: messageError } = await supabaseAdmin
        .from('messages')
        .insert({
          organization_id: organizationId,
          conversation_id: conversationId,
          sender_id: senderId,
          recipient_id: memberUserId,
          appointment_id: appointmentId,
          content,
          is_read: false,
        });

      if (messageError) {
        console.error('Error sending message to admin:', messageError);
      }
    }
  } catch (err) {
    console.error('Error sending messages to admins:', err);
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
