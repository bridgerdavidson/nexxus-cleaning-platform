import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { verifyAccessToken } from '../../../lib/auth/verifyToken';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing organizationId' },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization token' },
        { status: 401 }
      );
    }

    const verified = await verifyAccessToken(supabaseAdmin, token);

    if (!verified) {
      return NextResponse.json(
        { success: false, error: 'Failed to get user' },
        { status: 401 }
      );
    }

    // Caller must be a member of the org.
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', verified.userId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { success: false, error: 'Failed to check membership' },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { success: false, error: 'Not a member of this organization' },
        { status: 401 }
      );
    }

    // Allow org owners and admins, or managers with can_manage_cleaners.
    // (An org owner's organization_members.role is 'owner', not 'admin' — the
    // accept-invite mapping keeps OrgRole 'owner' while setting UserRole 'admin'.)
    // Homeowner (customer) invites are additionally gated on a customer
    // permission: a cleaner-only manager must not read customer email addresses
    // through this list.
    let isAuthorized = membership.role === 'owner' || membership.role === 'admin';
    let canSeeHomeownerInvites = isAuthorized;
    if (!isAuthorized && membership.role === 'manager') {
      const { data: managerPerms, error: permsError } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_manage_cleaners, can_view_customers, can_edit_customers')
        .eq('manager_id', verified.userId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (permsError) {
        return NextResponse.json(
          { success: false, error: 'Failed to check manager permissions' },
          { status: 500 }
        );
      }

      isAuthorized = managerPerms?.can_manage_cleaners === true;
      canSeeHomeownerInvites =
        managerPerms?.can_view_customers === true ||
        managerPerms?.can_edit_customers === true;
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Not authorized to view invites' },
        { status: 403 }
      );
    }

    // Lazy-expire stale pending rows so the admin UI reflects reality:
    //   1) expiration_date passed (the 7-day cutoff).
    //   2) opened_at set more than ~1h ago and never accepted — the magic
    //      link's access_token has expired and the recipient can't recover.
    const nowIso = new Date().toISOString();
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from('invites')
      .update({ status: 'expired' })
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .lt('expiration_date', nowIso);

    await supabaseAdmin
      .from('invites')
      .update({ status: 'expired' })
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .not('opened_at', 'is', null)
      .lt('opened_at', oneHourAgoIso);

    const { data: invites, error: invitesError } = await supabaseAdmin
      .from('invites')
      .select(
        `
          id,
          organization_id,
          email,
          role,
          status,
          sent_at,
          accepted_at,
          invited_by,
          expiration_date,
          opened_at,
          created_at,
          updated_at,
          invited_by_profile:user_profiles!invites_invited_by_fkey (
            first_name,
            last_name,
            email
          )
        `
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (invitesError) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch invites: ' + invitesError.message },
        { status: 500 }
      );
    }

    const now = Date.now();
    const enriched = (invites ?? [])
      // Hide homeowner (customer) invites from managers without a customer
      // permission; owners/admins and customer-permitted managers see all.
      .filter((inv) => canSeeHomeownerInvites || inv.role !== 'homeowner')
      .map((inv) => ({
        ...inv,
        is_expired:
          inv.status === 'pending' && new Date(inv.expiration_date).getTime() < now,
      }));

    return NextResponse.json({ success: true, invites: enriched }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
