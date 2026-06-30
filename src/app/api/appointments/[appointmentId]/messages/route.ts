// src/app/api/appointments/[appointmentId]/messages/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { uuidv4 } from '@/lib/uuid';

const MAX_CONTENT = 4000;

/**
 * POST /api/appointments/:appointmentId/messages
 *
 * Guarded homeowner<->cleaner job-thread send. `can_message_role` forbids the
 * homeowner<->cleaner pair, so this message cannot be inserted by the client
 * under RLS; the route authenticates the caller, enforces the gate, and writes
 * with the service-role admin client. RLS remains the backstop (the channel is
 * closed except through this route).
 *
 * Body: { content: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;

    // 1. Authenticate the caller (identity-gated, not org-role-gated).
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }
    const verified = await verifyAccessToken(supabaseAdmin, token);
    if (!verified) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { content?: unknown };

    // 2. Load the appointment.
    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, homeowner_id, cleaner_id, status, started_at, completed_at, cancelled_at')
      .eq('id', appointmentId)
      .maybeSingle();
    const appt = apptRow as {
      id: string;
      organization_id: string;
      homeowner_id: string | null;
      cleaner_id: string | null;
      status: string;
      started_at: string | null;
      completed_at: string | null;
      cancelled_at: string | null;
    } | null;
    if (!appt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // 3. The caller must be the current homeowner or the current assigned cleaner.
    let recipientId: string | null;
    if (verified.userId === appt.homeowner_id) {
      recipientId = appt.cleaner_id;
    } else if (verified.userId === appt.cleaner_id) {
      recipientId = appt.homeowner_id;
    } else {
      return NextResponse.json({ error: 'You are not a participant on this cleaning' }, { status: 403 });
    }

    // 4. The counterparty must exist (no cleaner assigned yet, or a self-pay job with no homeowner).
    if (!recipientId) {
      return NextResponse.json({ error: 'There is no one to message on this cleaning yet' }, { status: 409 });
    }
    // 4b. Defense-in-depth: a degenerate appointment where the same user is both
    //     parties would make p1 === p2 and violate the conversations
    //     different_participants CHECK (an opaque 500). Fail cleanly instead.
    if (recipientId === verified.userId) {
      return NextResponse.json({ error: 'There is no one to message on this cleaning yet' }, { status: 409 });
    }

    // 5. Org kill-switch.
    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('homeowner_cleaner_messaging_enabled')
      .eq('id', appt.organization_id)
      .maybeSingle();
    const messagingEnabled =
      (orgRow as { homeowner_cleaner_messaging_enabled: boolean } | null)?.homeowner_cleaner_messaging_enabled ?? true;
    if (!messagingEnabled) {
      return NextResponse.json({ error: 'Messaging is turned off for this company' }, { status: 403 });
    }

    // 6. Send window.
    if (!isJobMessagingWindowOpen(appt, new Date())) {
      return NextResponse.json({ error: 'Messaging is closed for this cleaning' }, { status: 403 });
    }

    // 7. Validate content last, so non-participants never reach it.
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }
    if (content.length > MAX_CONTENT) {
      return NextResponse.json(
        { error: `Message is too long (max ${MAX_CONTENT} characters)` },
        { status: 400 },
      );
    }

    // 8. Resolve (or create) the per-appointment conversation (service role only).
    const { data: convId, error: convError } = await supabaseAdmin.rpc('get_or_create_job_conversation', {
      p_user_a: verified.userId,
      p_user_b: recipientId,
      p_appointment_id: appointmentId,
    });
    if (convError || !convId) {
      return NextResponse.json(
        { error: 'Could not open the conversation', details: convError?.message },
        { status: 500 },
      );
    }

    // 9. Insert the message (bypasses RLS; the gate above is the authority). The
    //    update_conversation_last_message trigger maintains conversations.last_message_at.
    const messageId = uuidv4();
    const { error: insertError } = await supabaseAdmin.from('messages').insert({
      id: messageId,
      organization_id: appt.organization_id,
      conversation_id: convId as string,
      sender_id: verified.userId,
      recipient_id: recipientId,
      content,
      is_read: false,
      appointment_id: appointmentId,
    });
    if (insertError) {
      return NextResponse.json(
        { error: 'Could not send the message', details: insertError.message },
        { status: 500 },
      );
    }

    // 10. Notify the counterparty (best-effort). Sender display name comes from context.
    const ctx = await loadNotificationContext(supabaseAdmin, {
      appointmentId,
      cleanerId: appt.cleaner_id,
    });
    const senderIsCleaner = verified.userId === appt.cleaner_id;
    const senderName = senderIsCleaner ? ctx.cleaner_name : ctx.customer_name;
    const snippet = content.length > 140 ? `${content.slice(0, 140)}...` : content;
    await recordNotificationEvent(supabaseAdmin, {
      event_type: 'job_message',
      appointment_id: appointmentId,
      organization_id: appt.organization_id,
      recipient_user_id: recipientId,
      payload: {
        ...ctx,
        audience: senderIsCleaner ? 'homeowner' : 'cleaner',
        sender_name: senderName ?? null,
        snippet,
        message_id: messageId,
      },
      dedupe_key: `job_message:${messageId}`,
    });

    return NextResponse.json(
      {
        message: {
          id: messageId,
          conversation_id: convId,
          sender_id: verified.userId,
          recipient_id: recipientId,
          appointment_id: appointmentId,
          organization_id: appt.organization_id,
          content,
          is_read: false,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error sending job message:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
