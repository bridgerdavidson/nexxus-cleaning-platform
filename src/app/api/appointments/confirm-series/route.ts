import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { declineReasonLabel, type DeclineReason } from '@/types';
import { commitAcceptOffer, commitDeclineOffer, type OfferAppointment } from '@/lib/appointments/respondToOffer';

// Bulk accept/decline loops several Supabase reads + notification writes per
// occurrence; give headroom so a large series does not hit the default cap.
export const maxDuration = 60;

type SeriesAction = 'accept' | 'decline';

interface ConfirmSeriesInput {
  organizationId: string;
  seriesId: string;
  action: SeriesAction;
  declineReason?: DeclineReason;
  declineReasonOther?: string;
}

/**
 * Accept or decline EVERY occurrence of a recurring series that is still offered
 * (`awaiting` + `pending`) to the calling cleaner. Keyed by seriesId, not an
 * occurrence list, so the server always acts on the real awaiting set: a date the
 * cleaner already accepted or declined via the single confirm route is not
 * `awaiting` anymore and is untouched here (no double-processing). Each occurrence
 * is committed independently (a decline re-routes only that date). Returns a
 * per-occurrence tally so the client can show a partial-success toast.
 */
export async function POST(request: NextRequest) {
  try {
    const body: ConfirmSeriesInput = await request.json();
    const { organizationId, seriesId, action } = body;

    if (!organizationId || !seriesId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: organizationId, seriesId' },
        { status: 400 },
      );
    }
    if (action !== 'accept' && action !== 'decline') {
      return NextResponse.json(
        { success: false, error: "action must be 'accept' or 'decline'" },
        { status: 400 },
      );
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['cleaner', 'admin', 'owner', 'manager'],
    });
    if (!auth.ok) return auth.response;
    const cleanerId = auth.userId;

    // Resolve the decline reason once; every occurrence shares it.
    let reasonText: string | null = null;
    if (action === 'decline') {
      if (!body.declineReason) {
        return NextResponse.json(
          { success: false, error: 'declineReason is required when declining' },
          { status: 400 },
        );
      }
      const allowed: DeclineReason[] = ['sick', 'not_available', 'not_my_service', 'too_far', 'other'];
      if (!allowed.includes(body.declineReason)) {
        return NextResponse.json(
          { success: false, error: 'declineReason must be one of: sick | not_available | not_my_service | too_far | other' },
          { status: 400 },
        );
      }
      const label = declineReasonLabel(body.declineReason);
      reasonText =
        body.declineReason === 'other' && body.declineReasonOther?.trim()
          ? `${label}: ${body.declineReasonOther.trim()}`
          : label;
    }

    // Only the caller-cleaner's still-offered occurrences of this series.
    const { data: occRows, error: occError } = await supabaseAdmin
      .from('appointments')
      .select('id, status, homeowner_id, scheduled_date, scheduled_time')
      .eq('series_id', seriesId)
      .eq('organization_id', organizationId)
      .eq('cleaner_id', cleanerId)
      .eq('cleaner_confirmation_status', 'awaiting')
      .eq('status', 'pending')
      .order('scheduled_date', { ascending: true });

    if (occError) {
      console.error('Error loading series occurrences:', occError);
      return NextResponse.json(
        { success: false, error: 'Failed to load the series' },
        { status: 500 },
      );
    }

    const occurrences = (occRows ?? []) as OfferAppointment[];
    let succeeded = 0;
    let failed = 0;
    // Sequential: a series can hold many occurrences; process one at a time to
    // avoid a burst of concurrent writes. Partial failures never abort the loop.
    for (const appointment of occurrences) {
      try {
        if (action === 'accept') {
          await commitAcceptOffer(supabaseAdmin, { appointment, cleanerId, organizationId });
        } else {
          await commitDeclineOffer(supabaseAdmin, { appointment, cleanerId, organizationId, reasonText });
        }
        succeeded += 1;
      } catch (err) {
        console.error(`confirm-series ${action} failed for ${appointment.id}:`, err);
        failed += 1;
      }
    }

    return NextResponse.json({
      success: true,
      total: occurrences.length,
      succeeded,
      failed,
    });
  } catch (error) {
    console.error('Error in confirm-series POST:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
