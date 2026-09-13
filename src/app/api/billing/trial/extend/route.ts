// One-time self-serve 7-day trial extension, offered on the paywall and in the
// banner when 3 or fewer days remain.
//
// NEVER guarded by requireWritable: this route exists to get a frozen
// organization unfrozen, so guarding it would deadlock the paywall.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { ORG_BILLING_COLUMNS, deriveBillingAccess, type OrgBillingRow } from '@/lib/billing/access';
import { TRIAL_EXTENSION_DAYS } from '@/lib/billing/plans';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const organizationId = (body as { organization_id?: unknown } | null)?.organization_id;
    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    // Owner only. An admin may open checkout but may not move the trial clock.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner'],
    });
    if (!auth.ok) return auth.response;

    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select(ORG_BILLING_COLUMNS)
      .eq('id', organizationId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const org = data as unknown as OrgBillingRow;
    const access = deriveBillingAccess(org, new Date());

    if (access.state !== 'trialing' && access.state !== 'trial_expired') {
      return NextResponse.json({ error: 'There is no trial to extend.' }, { status: 409 });
    }
    if (!access.canExtendTrial) {
      return NextResponse.json({ error: 'This trial has already been extended.' }, { status: 409 });
    }

    // Extend from today when the trial already lapsed, so a late extension is
    // still worth a full seven days.
    const now = Date.now();
    const from = Math.max(now, org.trial_ends_at ? new Date(org.trial_ends_at).getTime() : now);
    const trialEndsAt = new Date(from + TRIAL_EXTENSION_DAYS * 86_400_000).toISOString();
    const extendedAt = new Date(now).toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('organizations')
      .update({
        // Also re-stamps 'trialing': an org whose subscription_status is still
        // the database default 'none' derives as trial_expired with
        // canExtendTrial true (deriveBillingAccess fails closed on 'none'
        // regardless of the clock), so without this the org would burn its one
        // extension and stay frozen anyway. Harmless on the normal path, since
        // the row is already 'trialing' there.
        subscription_status: 'trialing',
        trial_ends_at: trialEndsAt,
        trial_extended_at: extendedAt,
      })
      .eq('id', organizationId)
      // Belt and braces against a double click: only extend a trial that has
      // not been extended yet.
      .is('trial_extended_at', null)
      .select('id');

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    // supabase-js returns error: null for a zero-row update. Two simultaneous
    // requests can both read canExtendTrial: true before either writes; the
    // first UPDATE wins the `.is('trial_extended_at', null)` guard and the
    // second matches zero rows. Without this check the loser would answer 200
    // with a trial_ends_at it never persisted and write a second audit row.
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'This trial has already been extended.' }, { status: 409 });
    }

    await supabaseAdmin.from('tenant_subscription_events').insert({
      organization_id: organizationId,
      event_type: 'app.trial_extended',
      stripe_event_id: `app:${crypto.randomUUID()}`,
      payload: { trial_ends_at: trialEndsAt, extended_by: auth.userId },
    });

    return NextResponse.json({
      success: true,
      data: { trial_ends_at: trialEndsAt, trial_extended_at: extendedAt },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
