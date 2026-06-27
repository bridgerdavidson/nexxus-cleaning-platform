import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled, stripeFeePassthroughEnabled } from '@/lib/stripe/flags';
import { projectCompletionCharge } from '@/lib/payments/projectCompletionCharge';

export const runtime = 'nodejs';

/**
 * GET /api/appointments/:appointmentId/charge-projection
 *
 * Returns the projected customer charge and cleaner cut for an appointment using
 * the same math as the charge route, without calling Stripe. Consumed by the
 * cleaner Complete sheet to show authoritative post-fee numbers before submission.
 *
 * Query params: { organization_id }
 *
 * Returns: { projection: ChargeProjection }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const { appointmentId } = await params;
    const { searchParams } = request.nextUrl;
    const organization_id = searchParams.get('organization_id') ?? undefined;

    // Same guard as the charge route: org staff or assigned cleaner.
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'cleaner'],
    });
    if (!auth.ok) return auth.response;

    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('organization_id, is_self_pay, cleaner_id, total_price, payment_method_id')
      .eq('id', appointmentId)
      .maybeSingle();

    type ApptRow = {
      organization_id: string;
      is_self_pay: boolean;
      cleaner_id: string | null;
      total_price: number | string;
      payment_method_id: string | null;
    };

    if (!apptRow || (apptRow as ApptRow).organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const appt = apptRow as ApptRow;

    // A cleaner may only view the projection for their own appointment (mirrors the
    // charge route guard at line 66).
    if (auth.role === 'cleaner' && appt.cleaner_id !== auth.userId) {
      return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
    }

    // Self-pay projections expose the org's company-card math, so gate them behind Manage
    // Payments for managers (owner/admin always pass), the SAME fence as the charge route
    // (charge/route.ts lines 70-82).
    if (appt.is_self_pay === true && auth.role === 'manager') {
      const { data: perms } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_manage_payments')
        .eq('manager_id', auth.userId)
        .eq('organization_id', organization_id!)
        .maybeSingle();
      if (!(perms as { can_manage_payments: boolean } | null)?.can_manage_payments) {
        return NextResponse.json({ error: 'Requires the Manage Payments permission' }, { status: 403 });
      }
    }

    // Load cleaner payout_percent and org fields in parallel.
    const [cleanerRes, orgRes] = await Promise.all([
      appt.cleaner_id
        ? supabaseAdmin
            .from('cleaner_profiles')
            .select('payout_percent')
            .eq('id', appt.cleaner_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from('organizations')
        .select('platform_fee_bps, default_cleaner_payout_percent')
        .eq('id', organization_id!)
        .maybeSingle(),
    ]);

    type CleanerProfileRow = { payout_percent: number | string | null } | null;
    type OrgRow = { platform_fee_bps: number; default_cleaner_payout_percent: number } | null;

    const cleanerProfile = cleanerRes.data as CleanerProfileRow;
    const org = orgRes.data as OrgRow;

    // baseCents conversion: same as chargeCompletedAppointment.ts line 260.
    const baseCents = Math.round(Number(appt.total_price) * 100);

    // payoutPercent: cleaner profile -> org default -> 0.
    const payoutPercent =
      cleanerProfile?.payout_percent != null
        ? Number(cleanerProfile.payout_percent)
        : org?.default_cleaner_payout_percent != null
          ? Number(org.default_cleaner_payout_percent)
          : 0;

    // platformFeeBps: org field -> 0 (column is NOT NULL DEFAULT 0, so this is a safeguard).
    const platformFeeBps = org?.platform_fee_bps ?? 0;

    // Method: default 'card'. This route does not call Stripe to inspect the saved
    // payment method type, keeping it read-only and fast.
    const method: 'card' | 'us_bank_account' = 'card';

    const projection = projectCompletionCharge({
      baseCents,
      method,
      isSelfPay: appt.is_self_pay,
      payoutPercent,
      platformFeeBps,
      // Honor the same fee-passthrough flag the actual charge path uses so the sheet
      // never overstates the charge when passthrough is off.
      feePassthrough: stripeFeePassthroughEnabled(),
    });

    return NextResponse.json({ projection });
  } catch (error) {
    console.error('Error computing charge projection:', error);
    return NextResponse.json(
      {
        error: 'Failed to compute projection',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
