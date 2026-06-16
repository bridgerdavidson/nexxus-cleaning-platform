import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

/**
 * Notification-only endpoint for the reschedule flow. The reschedule itself is
 * persisted client-side (RescheduleAppointmentModal -> updateAppointment); this
 * route just lets the assigned cleaner know (via the notification bell) that
 * their job moved to a new date/time and needs re-confirmation.
 *
 * It does NOT mutate the appointment. It reads the appointment's current
 * cleaner_id (already updated by the modal) and emits an `appointment_rescheduled`
 * event to that cleaner. Best-effort: a missing cleaner or notification hiccup
 * resolves to `{ success: true, notified: false }` rather than an error, so the
 * reschedule UI never fails on a notification problem.
 */
interface NotifyRescheduleInput {
  appointmentId: string;
  organizationId: string;
}

export async function POST(request: NextRequest) {
  try {
    const { appointmentId, organizationId } =
      (await request.json()) as NotifyRescheduleInput;
    if (!appointmentId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'appointmentId and organizationId are required' },
        { status: 400 },
      );
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    // Appointment must belong to this org. Read its current cleaner_id (the
    // modal already reassigned it before calling here).
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, cleaner_id')
      .eq('id', appointmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (apptErr || !appt) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }

    const cleanerId = (appt as { cleaner_id: string | null }).cleaner_id;
    if (!cleanerId) {
      // Nothing to notify (unassigned). Not an error.
      return NextResponse.json({ success: true, notified: false });
    }

    const ctx = await loadNotificationContext(supabaseAdmin, { appointmentId, cleanerId });
    await recordNotificationEvent(supabaseAdmin, {
      event_type: 'appointment_rescheduled',
      appointment_id: appointmentId,
      organization_id: organizationId,
      recipient_user_id: cleanerId,
      payload: { ...ctx, audience: 'cleaner' },
    });

    return NextResponse.json({ success: true, notified: true });
  } catch (error) {
    console.error('Error in appointments/notify-reschedule POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
