import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create admin client for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

interface ConfirmAppointmentInput {
  appointmentId: string;
  cleanerId: string;
  confirmed: boolean;
  organizationId: string;
  feedback?: {
    reason: string;
    suggestedTimes?: {
      date: string; // YYYY-MM-DD
      time: string; // HH:mm
    }[];
    suggestedWindows?: {
      date: string; // YYYY-MM-DD
      startTime: string; // HH:mm
      endTime: string; // HH:mm
    }[];
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: ConfirmAppointmentInput = await request.json();
    const { appointmentId, cleanerId, confirmed, organizationId, feedback } = body;

    // Validate required fields
    if (!appointmentId || !cleanerId || confirmed === undefined || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: appointmentId, cleanerId, confirmed, organizationId' },
        { status: 400 }
      );
    }

    // Verify the appointment belongs to this cleaner
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, cleaner_id, homeowner_id, scheduled_date, scheduled_time, organization_id, service_type_id, status')
      .eq('id', appointmentId)
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
      // ===== CLEANER CONFIRMED =====
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

      // Send in-app message to admin(s)
      await sendMessageToAdmins({
        organizationId,
        senderId: cleanerId,
        appointmentId,
        content: `I've confirmed my availability for the appointment on ${appointment.scheduled_date} at ${appointment.scheduled_time}. I'm ready to go!`,
      });

      return NextResponse.json({
        success: true,
        message: 'Appointment confirmed successfully',
      });
    } else {
      // ===== CLEANER DECLINED =====
      if (!feedback?.reason) {
        return NextResponse.json(
          { success: false, error: 'A reason is required when declining an appointment' },
          { status: 400 }
        );
      }

      // Mark appointment as rejected
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

      // Delete any existing feedback for this appointment before inserting new feedback
      // This ensures only the most recent feedback is shown
      try {
        await supabaseAdmin
          .from('cleaner_availability_feedback')
          .delete()
          .eq('appointment_id', appointmentId);
      } catch (deleteErr) {
        console.error('Error deleting old feedback:', deleteErr);
        // Non-fatal - continue with inserting new feedback
      }

      // Insert feedback
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

      // Insert suggested times if provided
      if (feedback.suggestedTimes && feedback.suggestedTimes.length > 0) {
        const suggestedTimeRows = feedback.suggestedTimes.map((st) => ({
          feedback_id: feedbackData.id,
          suggested_date: st.date,
          suggested_time: st.time,
        }));

        const { error: timesError } = await supabaseAdmin
          .from('cleaner_suggested_times')
          .insert(suggestedTimeRows);

        if (timesError) {
          console.error('Error inserting suggested times:', timesError);
          // Non-fatal: feedback was saved, just log the error
        }
      }

      // Insert suggested windows if provided
      if (feedback.suggestedWindows && feedback.suggestedWindows.length > 0) {
        const suggestedWindowRows = feedback.suggestedWindows.map((sw) => ({
          feedback_id: feedbackData.id,
          window_date: sw.date,
          start_time: sw.startTime,
          end_time: sw.endTime,
        }));

        const { error: windowsError } = await supabaseAdmin
          .from('cleaner_suggested_windows')
          .insert(suggestedWindowRows);

        if (windowsError) {
          console.error('Error inserting suggested windows:', windowsError);
          // Non-fatal: feedback was saved, just log the error
        }
      }

      // Build message content with feedback details
      let messageContent = `I'm not available for the appointment on ${appointment.scheduled_date} at ${appointment.scheduled_time}.\n\nReason: ${feedback.reason}`;

      if (feedback.suggestedTimes && feedback.suggestedTimes.length > 0) {
        messageContent += '\n\nSuggested alternative times:';
        feedback.suggestedTimes.forEach((st) => {
          messageContent += `\n- ${st.date} at ${st.time}`;
        });
      }

      // Send in-app message to admin(s)
      await sendMessageToAdmins({
        organizationId,
        senderId: cleanerId,
        appointmentId,
        content: messageContent,
      });

      return NextResponse.json({
        success: true,
        message: 'Feedback submitted successfully',
        feedbackId: feedbackData.id,
      });
    }
  } catch (error) {
    console.error('Error in appointment confirm POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper: Send message to all admin users in the organization
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
    // Find admin users in the organization
    const { data: adminMembers, error: membersError } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .in('role', ['owner', 'admin']);

    if (membersError || !adminMembers || adminMembers.length === 0) {
      console.error('Could not find admins for organization:', membersError);
      return;
    }

    // Send a message to each admin via conversations
    for (const admin of adminMembers) {
      if (admin.user_id === senderId) continue; // Don't message yourself

      // Get or create conversation between cleaner and admin
      const { data: conversationId, error: convError } = await supabaseAdmin
        .rpc('get_or_create_conversation', {
          user1_id: senderId,
          user2_id: admin.user_id,
        });

      if (convError || !conversationId) {
        console.error('Error getting/creating conversation:', convError);
        continue;
      }

      // Insert the message
      const { error: messageError } = await supabaseAdmin
        .from('messages')
        .insert({
          organization_id: organizationId,
          conversation_id: conversationId,
          sender_id: senderId,
          recipient_id: admin.user_id,
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

// GET endpoint to fetch feedback for an appointment
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

    // Fetch feedback with suggested times and windows
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

    return NextResponse.json({
      success: true,
      data: feedback || [],
    });
  } catch (error) {
    console.error('Error in appointment confirm GET:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
