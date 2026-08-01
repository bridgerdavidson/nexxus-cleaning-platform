import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { createPayRequest } from '@/lib/payments/payRequests/createPayRequest';

/**
 * POST /api/appointments/:appointmentId/pay-request
 *
 * Opens the pay-request thread for a request-mode cleaner's job.
 *   - Cleaner (their own job): the "Request your pay" completion step. Runs
 *     the auto-approve threshold; over-price amounts escalate rather than
 *     erroring so the response can never leak the hidden job price.
 *   - Owner/admin, or manager with can_manage_payments (completing the job on
 *     the cleaner's behalf): creates an org-authored offer the cleaner must
 *     accept before any money moves.
 *
 * Body: { organization_id: string, amount_cents: number, note?: string }
 * 200 -> { payRequestId, status, autoApproved }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      organization_id?: string;
      amount_cents?: number;
      note?: string;
    };
    const organizationId = body.organization_id;

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'cleaner'],
    });
    if (!auth.ok) return auth.response;

    if (typeof body.note === 'string' && body.note.length > 1000) {
      return NextResponse.json({ error: 'Note is too long (1000 characters max).' }, { status: 400 });
    }

    // Load the appointment for authorization; existence/mode checks re-run
    // inside createPayRequest against the same row.
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, cleaner_id')
      .eq('id', appointmentId)
      .maybeSingle();
    const a = appt as { id: string; organization_id: string; cleaner_id: string | null } | null;
    // 404 (not 403) on any mismatch so probing can't confirm the id exists.
    if (!a || a.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    let actorKind: 'cleaner' | 'org';
    if (auth.role === 'cleaner') {
      if (a.cleaner_id !== auth.userId) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      }
      actorKind = 'cleaner';
    } else {
      if (auth.role === 'manager') {
        const { data: perms } = await supabaseAdmin
          .from('manager_permissions')
          .select('can_manage_payments')
          .eq('manager_id', auth.userId)
          .eq('organization_id', organizationId!)
          .maybeSingle();
        if (!(perms as { can_manage_payments: boolean } | null)?.can_manage_payments) {
          return NextResponse.json(
            { error: 'Requires the Manage Payments permission' },
            { status: 403 },
          );
        }
      }
      actorKind = 'org';
    }

    const result = await createPayRequest(supabaseAdmin, {
      appointmentId,
      actorUserId: auth.userId,
      actorKind,
      amountCents: body.amount_cents as number,
      note: body.note ?? null,
    });

    if (!result.ok) {
      // 'over_price' only ever reaches org actors (cleaner asks are uncapped
      // and escalate), so its copy cannot leak the price to a cleaner.
      const status =
        result.code === 'not_found' ? 404
        : result.code === 'duplicate' ? 409
        : result.code === 'cancelled' ? 409
        : 400;
      return NextResponse.json({ error: result.message }, { status });
    }

    return NextResponse.json({
      payRequestId: result.payRequestId,
      status: result.status,
      autoApproved: result.autoApproved,
    });
  } catch (err) {
    console.error('pay-request POST failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
