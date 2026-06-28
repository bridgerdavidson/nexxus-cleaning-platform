import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export const runtime = 'nodejs';

/**
 * POST /api/appointments/:appointmentId/photo-skip
 *
 * Records a cleaner's reason for skipping required photos on an appointment.
 * Writes appointments.photos_skipped = true and appointments.photo_skip_reason.
 *
 * Body: { organizationId: string, reason: string }
 *
 * Auth: assigned cleaner OR any org staff (owner/admin/manager/cleaner).
 * No payment permission gate; this is a job-progress action, not a payment action.
 *
 * Returns: { ok: true }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;
    const body = await request.json().catch(() => ({}));
    const { organizationId, reason } = body as {
      organizationId?: string;
      reason?: string;
    };

    // Auth first (401/403 before body validation errors).
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'cleaner'],
    });
    if (!auth.ok) return auth.response;

    // Validate reason after auth so we don't leak 400 vs 401/403 ordering.
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }

    // Load appointment to verify org scope and cleaner assignment.
    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('organization_id, cleaner_id')
      .eq('id', appointmentId)
      .maybeSingle();

    type ApptRow = { organization_id: string; cleaner_id: string | null } | null;
    const appt = apptRow as ApptRow;

    if (!appt || appt.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // IDOR guard: a cleaner may only skip photos for their own appointment.
    if (auth.role === 'cleaner' && appt.cleaner_id !== auth.userId) {
      return NextResponse.json(
        { error: 'This appointment is not assigned to you' },
        { status: 403 },
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({ photos_skipped: true, photo_skip_reason: trimmedReason })
      .eq('id', appointmentId);

    if (updateError) {
      console.error('photo-skip update failed:', updateError);
      return NextResponse.json({ error: 'Failed to record photo skip' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error recording photo skip:', error);
    return NextResponse.json(
      {
        error: 'Failed to record photo skip',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
