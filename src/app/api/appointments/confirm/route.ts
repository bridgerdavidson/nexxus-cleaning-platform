import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { formatTimeTo12h } from '@/lib/formatTime';

interface ConfirmAppointmentInput {
  appointmentId: string;
  confirmed: boolean;
  organizationId: string;
  feedback?: {
    reason: string;
    suggestedTimes?: { date: string; time: string }[];
    suggestedWindows?: { date: string; startTime: string; endTime: string }[];
  };
}

function formatDateShort(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const twoDigitYear = year % 100;
  return `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${twoDigitYear.toString().padStart(2, '0')}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: ConfirmAppointmentInput = await request.json();
    const { appointmentId, confirmed, organizationId, feedback } = body;

    if (!appointmentId || confirmed === undefined || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: appointmentId, confirmed, organizationId' },
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
      .select('id, cleaner_id, homeowner_id, scheduled_date, scheduled_time, organization_id, service_type_id, status')
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

    if (confirmed) {
      const updatePayload =
        appointment.status === 'pending'
          ? { cleaner_confirmation_status: 'approved', status: 'confirmed' }
          : { cleaner_confirmation_status: 'approved' };

      const { error: updateError } = await supabaseAdmin
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId);

      if (updateError) {
        console.error('Error confirming appointment:', updateError);
        return NextResponse.json(
          { success: false, error: 'Failed to confirm appointment' },
          { status: 500 }
        );
      }

      await sendMessageToAdmins({
        organizationId,
        senderId: cleanerId,
        appointmentId,
        content: `I've confirmed my availability for the appointment on ${formatDateShort(appointment.scheduled_date as string)} at ${formatTimeTo12h(appointment.scheduled_time as string)}. I'm ready to go!`,
      });

      return NextResponse.json({ success: true, message: 'Appointment confirmed successfully' });
    }

    // ===== CLEANER DECLINED =====
    if (!feedback?.reason) {
      return NextResponse.json(
        { success: false, error: 'A reason is required when declining an appointment' },
        { status: 400 }
      );
    }

    const rejectPayload =
      appointment.status === 'confirmed'
        ? { cleaner_confirmation_status: 'rejected', status: 'pending' }
        : { cleaner_confirmation_status: 'rejected' };

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
        reason: feedback.reason,
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

    if (feedback.suggestedTimes && feedback.suggestedTimes.length > 0) {
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

    if (feedback.suggestedWindows && feedback.suggestedWindows.length > 0) {
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

    let messageContent = `I'm not available for the appointment on ${formatDateShort(appointment.scheduled_date as string)} at ${formatTimeTo12h(appointment.scheduled_time as string)}.\n\nReason: ${feedback.reason}`;
    if (feedback.suggestedTimes && feedback.suggestedTimes.length > 0) {
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

    return NextResponse.json({
      success: true,
      message: 'Feedback submitted successfully',
      feedbackId: (feedbackData as { id: string }).id,
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

    return NextResponse.json({ success: true, data: feedback || [] });
  } catch (error) {
    console.error('Error in appointment confirm GET:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
