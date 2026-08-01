import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export const runtime = 'nodejs';

/**
 * POST /api/cleaner/appointments/[appointmentId]/status
 * Body: { organization_id, status?, job_progress? }
 *
 * The cleaner's job status/progress write path. Before the price-seal migration this was
 * a direct client UPDATE under the appointments_update cleaner arm; the seal
 * removed the cleaner's SELECT arm, and a Postgres UPDATE's WHERE clause needs
 * SELECT rights on the row, so a direct cleaner UPDATE now matches zero rows.
 * This route replaces it, and is deliberately narrower than the old RLS arm:
 * only the assigned cleaner, only their own org's job, and only the two
 * columns the app ever wrote (the old arm technically allowed a cleaner to
 * update ANY column of their appointment, total_price included).
 *
 * Existing DB triggers (e.g. the cancelled-job completion block) still fire on
 * this update, unchanged.
 */

const ALLOWED_STATUS = new Set(['in_progress', 'completed']);
const ALLOWED_PROGRESS = new Set([
  'not_started',
  'before_photos',
  'checklist',
  'after_photos',
  'completed',
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      organization_id?: string;
      status?: string;
      job_progress?: string;
    };

    const auth = await requireOrgAuth(request, body.organization_id, supabaseAdmin, {
      allowedRoles: ['cleaner'],
    });
    if (!auth.ok) return auth.response;

    const update: { status?: string; job_progress?: string } = {};
    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.has(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      update.status = body.status;
    }
    if (body.job_progress !== undefined) {
      if (!ALLOWED_PROGRESS.has(body.job_progress)) {
        return NextResponse.json({ error: 'Invalid job progress' }, { status: 400 });
      }
      update.job_progress = body.job_progress;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Only the assigned cleaner, only in their own org. 404 either way so the
    // response never confirms a foreign appointment id exists.
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, cleaner_id')
      .eq('id', appointmentId)
      .maybeSingle();
    const row = appt as { organization_id: string; cleaner_id: string | null } | null;
    if (!row || row.organization_id !== body.organization_id || row.cleaner_id !== auth.userId) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('appointments')
      .update(update)
      .eq('id', appointmentId);
    if (error) {
      // Surface trigger rejections (e.g. completing a cancelled job) as a 409
      // with the database's message, mirroring what the old direct write threw.
      console.error('cleaner status update failed:', error);
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('cleaner/appointments/status failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
