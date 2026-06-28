import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/cleaner-experience
 *
 * OWNER-ONLY: sets org-wide cleaner experience controls.
 *   - cleaner_pay_display  ('full' | 'payout_only') — what cleaners see at job complete
 *   - require_job_photos   (boolean)                — enforce before+after photo gate
 *
 * Both columns already exist (migrations 095, 096). This route only updates them.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await params;

    const auth = await requireOrgAuth(request, orgId, supabaseAdmin, {
      allowedRoles: ['owner'],
    });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      cleaner_pay_display?: string;
      require_job_photos?: unknown;
    };

    const update: Record<string, unknown> = {};

    if (body.cleaner_pay_display !== undefined) {
      if (!['full', 'payout_only'].includes(body.cleaner_pay_display)) {
        return NextResponse.json(
          { error: 'cleaner_pay_display must be "full" or "payout_only"' },
          { status: 400 },
        );
      }
      update.cleaner_pay_display = body.cleaner_pay_display;
    }

    if (body.require_job_photos !== undefined) {
      update.require_job_photos = Boolean(body.require_job_photos);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('organizations')
      .update(update)
      .eq('id', orgId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update cleaner experience settings', details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, ...update });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
