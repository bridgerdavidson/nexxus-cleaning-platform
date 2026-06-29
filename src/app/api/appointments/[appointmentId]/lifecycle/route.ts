import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

/**
 * POST /api/appointments/:appointmentId/lifecycle
 *
 * Emits a job-lifecycle notification (job_started / job_completed) to the
 * homeowner + admins. The status write itself happens client-side in
 * `updateAppointmentStatus`; this route exists only because notification_events
 * has no client INSERT policy, so the outbox row must be written with the
 * service role. Verified: the caller must be the assigned cleaner (or org
 * staff). Best-effort from the client's point of view.
 *
 * Body: { organizationId: string, event: 'started' | 'completed' }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;
    const body = await request.json().catch(() => ({}));
    const { organizationId, event } = body as {
      organizationId?: string;
      event?: 'started' | 'completed';
    };

    // Auth first (401/403 win over body validation).
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['cleaner', 'admin', 'owner', 'manager'],
    });
    if (!auth.ok) return auth.response;

    if (event !== 'started' && event !== 'completed') {
      return NextResponse.json(
        { error: "event must be 'started' or 'completed'" },
        { status: 400 },
      );
    }

    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, cleaner_id, homeowner_id')
      .eq('id', appointmentId)
      .maybeSingle();
    const appt = apptRow as {
      id: string;
      organization_id: string;
      cleaner_id: string | null;
      homeowner_id: string | null;
    } | null;
    if (!appt || appt.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    // A cleaner may only signal lifecycle for their own job.
    if (auth.role === 'cleaner' && appt.cleaner_id !== auth.userId) {
      return NextResponse.json(
        { error: 'This appointment is not assigned to you' },
        { status: 403 },
      );
    }

    // Stamp started_at / completed_at. The .is(..., null) guard keeps the
    // first timestamp stable across retries / realtime re-fires (idempotent).
    await supabaseAdmin
      .from('appointments')
      .update(
        event === 'started'
          ? { started_at: new Date().toISOString() }
          : { completed_at: new Date().toISOString() },
      )
      .eq('id', appointmentId)
      .is(event === 'started' ? 'started_at' : 'completed_at', null);

    const eventType = event === 'started' ? 'job_started' : 'job_completed';
    const ctx = await loadNotificationContext(supabaseAdmin, {
      appointmentId,
      cleanerId: appt.cleaner_id,
    });

    // Homeowner (their cleaning is happening) + admins (visibility). Self-pay
    // appointments have no homeowner, so only admins are notified.
    if (appt.homeowner_id) {
      await recordNotificationEvent(supabaseAdmin, {
        event_type: eventType,
        appointment_id: appointmentId,
        organization_id: organizationId as string,
        recipient_user_id: appt.homeowner_id,
        payload: { ...ctx, audience: 'homeowner' },
      });
    }
    await recordNotificationEvent(supabaseAdmin, {
      event_type: eventType,
      appointment_id: appointmentId,
      organization_id: organizationId as string,
      payload: { ...ctx, audience: 'admin' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error recording job lifecycle notification:', error);
    return NextResponse.json(
      {
        error: 'Failed to record lifecycle notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
