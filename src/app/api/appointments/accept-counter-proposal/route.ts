import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

interface AcceptCounterProposalInput {
  appointmentId: string;
  organizationId: string;
  /** Exactly one of these must be provided. */
  suggestedTimeId?: string;
  suggestedWindowId?: string;
  /**
   * When picking a window, the admin must supply the concrete time within it
   * to assign to the appointment (HH:mm). When picking a time, this is ignored.
   */
  windowStartTime?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: AcceptCounterProposalInput = await request.json();
    const { appointmentId, organizationId, suggestedTimeId, suggestedWindowId, windowStartTime } = body;

    if (!appointmentId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: appointmentId, organizationId' },
        { status: 400 }
      );
    }
    if (!suggestedTimeId && !suggestedWindowId) {
      return NextResponse.json(
        { success: false, error: 'Provide either suggestedTimeId or suggestedWindowId' },
        { status: 400 }
      );
    }
    if (suggestedTimeId && suggestedWindowId) {
      return NextResponse.json(
        { success: false, error: 'Provide only one of suggestedTimeId or suggestedWindowId' },
        { status: 400 }
      );
    }

    // Admin/manager/owner only. Cleaners cannot self-accept their own counter-proposal.
    const auth = await requireManagerPermission(request, organizationId, supabaseAdmin, 'can_handle_requests', {
      errorMessage: 'Requires the Handle Requests permission',
    });
    if (!auth.ok) return auth.response;

    // Verify the appointment belongs to this org.
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, cleaner_id, homeowner_id, scheduled_date, scheduled_time, organization_id, status, cleaner_confirmation_status')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .single();

    if (appointmentError || !appointment) {
      return NextResponse.json(
        { success: false, error: 'Appointment not found' },
        { status: 404 }
      );
    }

    const cleanerId = (appointment as { cleaner_id: string | null }).cleaner_id;
    if (!cleanerId) {
      return NextResponse.json(
        { success: false, error: 'Appointment has no cleaner assigned' },
        { status: 409 }
      );
    }

    // Must currently be in the "cleaner rejected" state for acceptance to be meaningful.
    if ((appointment as { cleaner_confirmation_status: string }).cleaner_confirmation_status !== 'rejected') {
      return NextResponse.json(
        { success: false, error: 'Appointment is not awaiting counter-proposal acceptance' },
        { status: 409 }
      );
    }

    // Pull the picked suggestion + its parent feedback row (which must belong
    // to this appointment + cleaner). Hard-delete strategy: we keep the
    // feedback for audit until after the appointment update succeeds, then
    // clear both the feedback row and its child suggestions.
    let pickedDate: string;
    let pickedTime: string;
    let feedbackId: string;

    if (suggestedTimeId) {
      const { data: suggested, error: sErr } = await supabaseAdmin
        .from('cleaner_suggested_times')
        .select(`
          id, suggested_date, suggested_time, feedback_id,
          cleaner_availability_feedback!inner ( appointment_id, cleaner_id )
        `)
        .eq('id', suggestedTimeId)
        .single();
      if (sErr || !suggested) {
        return NextResponse.json(
          { success: false, error: 'Suggested time not found' },
          { status: 404 }
        );
      }
      const fb = (suggested as unknown as { cleaner_availability_feedback: { appointment_id: string; cleaner_id: string } | { appointment_id: string; cleaner_id: string }[] }).cleaner_availability_feedback;
      const fbRow = Array.isArray(fb) ? fb[0] : fb;
      if (!fbRow || fbRow.appointment_id !== appointmentId || fbRow.cleaner_id !== cleanerId) {
        return NextResponse.json(
          { success: false, error: 'Suggested time does not belong to this appointment' },
          { status: 400 }
        );
      }
      pickedDate = (suggested as { suggested_date: string }).suggested_date;
      pickedTime = (suggested as { suggested_time: string }).suggested_time;
      feedbackId = (suggested as { feedback_id: string }).feedback_id;
    } else {
      // suggestedWindowId path
      if (!windowStartTime) {
        return NextResponse.json(
          { success: false, error: 'windowStartTime is required when picking a suggested window' },
          { status: 400 }
        );
      }
      const { data: suggested, error: sErr } = await supabaseAdmin
        .from('cleaner_suggested_windows')
        .select(`
          id, window_date, start_time, end_time, feedback_id,
          cleaner_availability_feedback!inner ( appointment_id, cleaner_id )
        `)
        .eq('id', suggestedWindowId!)
        .single();
      if (sErr || !suggested) {
        return NextResponse.json(
          { success: false, error: 'Suggested window not found' },
          { status: 404 }
        );
      }
      const fb = (suggested as unknown as { cleaner_availability_feedback: { appointment_id: string; cleaner_id: string } | { appointment_id: string; cleaner_id: string }[] }).cleaner_availability_feedback;
      const fbRow = Array.isArray(fb) ? fb[0] : fb;
      if (!fbRow || fbRow.appointment_id !== appointmentId || fbRow.cleaner_id !== cleanerId) {
        return NextResponse.json(
          { success: false, error: 'Suggested window does not belong to this appointment' },
          { status: 400 }
        );
      }
      // Validate that windowStartTime falls within the window.
      const startT = (suggested as { start_time: string }).start_time;
      const endT = (suggested as { end_time: string }).end_time;
      if (windowStartTime < startT || windowStartTime >= endT) {
        return NextResponse.json(
          { success: false, error: 'windowStartTime must fall within the suggested window' },
          { status: 400 }
        );
      }
      pickedDate = (suggested as { window_date: string }).window_date;
      pickedTime = windowStartTime;
      feedbackId = (suggested as { feedback_id: string }).feedback_id;
    }

    // Atomically (best-effort) flip the appointment to confirmed at the picked time.
    // Cleaner already responded (suggested the time), so the SLA deadline clears.
    const { error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        scheduled_date: pickedDate,
        scheduled_time: pickedTime,
        status: 'confirmed',
        cleaner_confirmation_status: 'approved',
        response_deadline: null,
      })
      .eq('id', appointmentId);

    if (updateError) {
      console.error('Error updating appointment with counter-proposal:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update appointment' },
        { status: 500 }
      );
    }

    // Hard-delete the feedback row and its children (suggested times/windows
    // cascade on feedback_id).
    try {
      await supabaseAdmin.from('cleaner_availability_feedback').delete().eq('id', feedbackId);
    } catch (deleteErr) {
      // Non-fatal — the appointment update already succeeded. Log and proceed.
      console.error('Error clearing feedback after counter-proposal accept:', deleteErr);
    }

    // Tell the cleaner (via the notification bell) that their proposed time was
    // accepted and the job is now confirmed. Best-effort; never blocks the response.
    const cleanerCtx = await loadNotificationContext(supabaseAdmin, {
      appointmentId,
      cleanerId,
    });
    await recordNotificationEvent(supabaseAdmin, {
      event_type: 'cleaner_counter_accepted',
      appointment_id: appointmentId,
      organization_id: organizationId,
      recipient_user_id: cleanerId,
      payload: {
        ...cleanerCtx,
        audience: 'cleaner',
        scheduled_date: pickedDate,
        scheduled_time: pickedTime,
      },
    });

    // Decision 4 (spec): both settle paths tell the homeowner the final time.
    if ((appointment as { homeowner_id: string | null }).homeowner_id) {
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'appointment_time_changed',
        appointment_id: appointmentId,
        organization_id: organizationId,
        recipient_user_id: (appointment as { homeowner_id: string }).homeowner_id,
        payload: {
          ...cleanerCtx,
          audience: 'homeowner',
          scheduled_date: pickedDate,
          scheduled_time: pickedTime,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Counter-proposal accepted',
      scheduled_date: pickedDate,
      scheduled_time: pickedTime,
    });
  } catch (error) {
    console.error('Error in accept-counter-proposal POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
