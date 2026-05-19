import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { formatTimeTo12h } from '@/lib/formatTime';

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

function formatDateShort(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const twoDigitYear = year % 100;
  return `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${twoDigitYear.toString().padStart(2, '0')}`;
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
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;
    const adminUserId = auth.userId;

    // Verify the appointment belongs to this org.
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, cleaner_id, scheduled_date, scheduled_time, organization_id, status, cleaner_confirmation_status')
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
    const { error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        scheduled_date: pickedDate,
        scheduled_time: pickedTime,
        status: 'confirmed',
        cleaner_confirmation_status: 'approved',
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

    // Message the cleaner so they see the confirmation in their thread with the admin.
    await sendMessageToCleaner({
      organizationId,
      senderId: adminUserId,
      recipientId: cleanerId,
      appointmentId,
      content: `I've accepted your alternative time for the appointment on ${formatDateShort(pickedDate)} at ${formatTimeTo12h(pickedTime)}. You're confirmed.`,
    });

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

async function sendMessageToCleaner({
  organizationId,
  senderId,
  recipientId,
  appointmentId,
  content,
}: {
  organizationId: string;
  senderId: string;
  recipientId: string;
  appointmentId: string;
  content: string;
}) {
  try {
    const { data: conversationId, error: convError } = await supabaseAdmin.rpc(
      'get_or_create_conversation',
      { user1_id: senderId, user2_id: recipientId },
    );
    if (convError || !conversationId) {
      console.error('Error getting/creating conversation:', convError);
      return;
    }
    const { error: messageError } = await supabaseAdmin.from('messages').insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      sender_id: senderId,
      recipient_id: recipientId,
      appointment_id: appointmentId,
      content,
      is_read: false,
    });
    if (messageError) console.error('Error sending message to cleaner:', messageError);
  } catch (err) {
    console.error('Error sending message to cleaner:', err);
  }
}
