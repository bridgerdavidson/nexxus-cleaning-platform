// The one client read of billing state. Returns the RAW columns so the client
// can call deriveBillingAccess itself: spec §7 requires exactly one definition
// of "frozen", and access.ts is client-safe (it imports only ./plans, which has
// no imports). Never compute a verdict here.
//
// Deliberately NOT behind assertOrgWritable / requireWritable. Reading billing
// state is how a frozen organization learns it is frozen; guarding it would be
// circular and would deadlock the paywall.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { ORG_BILLING_COLUMNS, type OrgBillingRow } from '@/lib/billing/access';
import { countSeatsInUse } from '@/lib/billing/seats';

export const runtime = 'nodejs';

export interface BillingStatePayload {
  billing: OrgBillingRow;
  seats_in_use: number;
  role: 'owner' | 'admin' | 'manager';
  /**
   * organizations.subscription_current_period_end, used for the "Renews on"
   * line. Deliberately NOT folded into ORG_BILLING_COLUMNS: that constant is
   * the deriveBillingAccess contract, and widening it would ripple into every
   * server guard call site for a field the state machine never reads.
   */
  current_period_end: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const organizationId = request.nextUrl.searchParams.get('organization_id');
    if (!organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    // Operator-shell roles only. Cleaners and homeowners have their own shells
    // and never render billing chrome. A manager is allowed on purpose: a
    // manager whose work is blocked has to be able to learn why.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select(`${ORG_BILLING_COLUMNS}, subscription_current_period_end`)
      .eq('id', organizationId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Could not load billing state' }, { status: 500 });
    }

    // Split the renewal date off the row rather than spreading the whole row
    // into `billing`, so `billing` is exactly OrgBillingRow and the extra field
    // appears in exactly one place in the payload.
    const { subscription_current_period_end: currentPeriodEnd, ...billing } =
      data as unknown as OrgBillingRow & { subscription_current_period_end: string | null };

    const payload: BillingStatePayload = {
      billing,
      seats_in_use: await countSeatsInUse(supabaseAdmin, organizationId),
      role: auth.role as BillingStatePayload['role'],
      current_period_end: currentPeriodEnd ?? null,
    };

    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
