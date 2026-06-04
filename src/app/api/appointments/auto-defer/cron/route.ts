import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { advanceAppointmentRouting } from '@/lib/appointments/advanceRouting';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

export const runtime = 'nodejs';

/**
 * pg_cron-triggered sweep that processes every org with expired pending
 * routing rows. Replaces the opportunistic dashboard-load polling for the
 * "nobody opened the dashboard right after the deadline elapsed" case.
 *
 * Auth: shared-secret header `Authorization: Bearer <CRON_SECRET>`. The
 * secret is configured in pg_cron's job command (see migration 064) and as
 * a Next.js env var.
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!auth || !process.env.CRON_SECRET || auth !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data: expired } = await supabaseAdmin
    .from('appointment_routing_log')
    .select('id, appointment_id, cleaner_id, appointments!inner(organization_id)')
    .eq('response', 'pending')
    .lt('deadline_at', new Date().toISOString());

  type ExpiredRow = {
    id: string;
    appointment_id: string;
    cleaner_id: string | null;
    appointments: { organization_id: string } | { organization_id: string }[] | null;
  };

  const seen = new Set<string>();
  const outcomes: Array<{ appointmentId: string; outcome: string }> = [];

  for (const row of ((expired ?? []) as unknown as ExpiredRow[])) {
    if (seen.has(row.appointment_id)) continue;
    seen.add(row.appointment_id);

    const appt = Array.isArray(row.appointments) ? row.appointments[0] : row.appointments;
    if (!appt) continue;
    const organizationId = appt.organization_id;

    // Flip the pending row(s) for this appointment to expired before advancing.
    await supabaseAdmin
      .from('appointment_routing_log')
      .update({
        response: 'expired',
        responded_at: new Date().toISOString(),
        decline_reason: 'expired',
      })
      .eq('appointment_id', row.appointment_id)
      .eq('response', 'pending');

    const outcome = await advanceAppointmentRouting({
      appointmentId: row.appointment_id,
      organizationId,
      supabaseAdmin,
    });
    outcomes.push({ appointmentId: row.appointment_id, outcome: outcome.kind });

    const deferCtx = await loadNotificationContext(supabaseAdmin, {
      appointmentId: row.appointment_id,
      cleanerId: row.cleaner_id,
    });
    await recordNotificationEvent(supabaseAdmin, {
      event_type: 'cleaner_response_overdue',
      appointment_id: row.appointment_id,
      organization_id: organizationId,
      payload: { ...deferCtx, audience: 'admin' },
    });
    if (outcome.kind === 'escalated') {
      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'chain_exhausted',
        appointment_id: row.appointment_id,
        organization_id: organizationId,
        payload: { ...deferCtx, audience: 'admin' },
      });
    }
  }

  return NextResponse.json({ success: true, processed: outcomes.length, outcomes });
}
