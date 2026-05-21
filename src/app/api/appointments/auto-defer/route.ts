import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { advanceAppointmentRouting } from '@/lib/appointments/advanceRouting';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';

interface AutoDeferInput {
  organizationId: string;
  appointmentId?: string;
}

/**
 * Bulk + single-appointment timeout sweep. Mirrors the "derived on read"
 * pattern of migration 058 — no pg_cron; the admin queue and cleaner
 * dashboard load fire this opportunistically. Idempotent.
 */
export async function POST(request: NextRequest) {
  try {
    const { organizationId, appointmentId } = (await request.json()) as AutoDeferInput;
    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: 'organizationId is required' },
        { status: 400 },
      );
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'cleaner', 'homeowner'],
    });
    if (!auth.ok) return auth.response;

    // Find expired pending routing rows in this org. Both homeowner-initiated
    // requests and admin-direct appointments enter the routing chain when a
    // cleaner declines (confirm/route.ts inserts a routing_log row for both
    // flows), so the sweep must process both — otherwise the reassigned
    // cleaner can ghost an admin-direct appointment and it sits in `awaiting`
    // forever.
    let query = supabaseAdmin
      .from('appointment_routing_log')
      .select('id, appointment_id, deadline_at, appointment:appointments!inner(id, organization_id)')
      .eq('response', 'pending')
      .lt('deadline_at', new Date().toISOString());
    if (appointmentId) {
      query = query.eq('appointment_id', appointmentId);
    }
    const { data: expiredRows } = await query;

    type ExpiredRow = {
      id: string;
      appointment_id: string;
      appointment: { organization_id: string } |
                   { organization_id: string }[] | null;
    };

    const expired = ((expiredRows ?? []) as unknown as ExpiredRow[]).filter((row) => {
      const appt = Array.isArray(row.appointment) ? row.appointment[0] : row.appointment;
      return !!appt && appt.organization_id === organizationId;
    });

    const outcomes: Array<{ appointmentId: string; outcome: string }> = [];
    for (const row of expired) {
      // Mark the row expired before advancing so the chain sees a terminal state.
      await supabaseAdmin
        .from('appointment_routing_log')
        .update({
          response: 'expired',
          responded_at: new Date().toISOString(),
          decline_reason: 'expired',
        })
        .eq('id', row.id);
      const result = await advanceAppointmentRouting({
        appointmentId: row.appointment_id,
        organizationId,
        supabaseAdmin,
      });
      outcomes.push({ appointmentId: row.appointment_id, outcome: result.kind });

      await recordNotificationEvent(supabaseAdmin, {
        event_type: 'cleaner_response_overdue',
        appointment_id: row.appointment_id,
        organization_id: organizationId,
      });
      if (result.kind === 'escalated') {
        await recordNotificationEvent(supabaseAdmin, {
          event_type: 'chain_exhausted',
          appointment_id: row.appointment_id,
          organization_id: organizationId,
        });
      }
    }

    return NextResponse.json({ success: true, processed: outcomes.length, outcomes });
  } catch (error) {
    console.error('Error in appointments/auto-defer POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
