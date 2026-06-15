import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { verifyAccessToken } from '../../../../lib/auth/verifyToken';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, role, organizationId } = body;

    // ── Auth: validate caller session ────────────────────────────────────────
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const verified = await verifyAccessToken(supabaseAdmin, token);

    if (!verified) {
      return NextResponse.json(
        { success: false, error: 'Failed to get user' },
        { status: 401 }
      );
    }

    // ── Auth: confirm caller is an admin of the org ──────────────────────────
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', verified.userId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { success: false, error: 'Failed to get membership' },
        { status: 401 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { success: false, error: 'User is not a member of the organization' },
        { status: 401 }
      );
    }

    // Allow org owners and admins, or managers with can_manage_cleaners.
    // (An org owner's organization_members.role is 'owner', not 'admin' — the
    // accept-invite mapping keeps OrgRole 'owner' while setting UserRole 'admin'.)
    let isAuthorized = membership.role === 'owner' || membership.role === 'admin';
    if (!isAuthorized && membership.role === 'manager') {
      const { data: managerPerms, error: permsError } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_manage_cleaners')
        .eq('manager_id', verified.userId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (permsError) {
        return NextResponse.json(
          { success: false, error: 'Failed to check manager permissions' },
          { status: 401 }
        );
      }

      isAuthorized = managerPerms?.can_manage_cleaners === true;
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Not authorized to send invites' },
        { status: 401 }
      );
    }

    // ── Input validation ─────────────────────────────────────────────────────
    if (!email || !role || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Normalize email — aligns with invites_email_lowercase DB constraint
    const normalizedEmail = email.trim().toLowerCase();

    if (!['cleaner', 'manager', 'admin'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role. Must be "cleaner", "manager", or "admin"' },
        { status: 400 }
      );
    }

    // ── Role ceiling ─────────────────────────────────────────────────────────
    // A manager is authorized here only via can_manage_cleaners, so they may
    // invite cleaners only — never a manager or admin, which would let them mint
    // a peer/superior who could then revoke them. Owners and admins may invite up
    // to admin; nobody can invite an owner (not in the allowlist above).
    if (membership.role === 'manager' && role !== 'cleaner') {
      return NextResponse.json(
        { success: false, error: 'Managers can only invite cleaners.' },
        { status: 403 }
      );
    }

    // ── Guard 1: block if an accepted invite already exists for this org ──────
    // An accepted invite means the user completed onboarding — do not overwrite.
    const { data: acceptedInvite, error: acceptedInviteError } = await supabaseAdmin
      .from('invites')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('organization_id', organizationId)
      .eq('status', 'accepted')
      .maybeSingle();

    if (acceptedInviteError) {
      return NextResponse.json(
        { success: false, error: 'Failed to check invite history' },
        { status: 500 }
      );
    }

    if (acceptedInvite) {
      return NextResponse.json(
        { success: false, error: 'An account with this email has already been activated. No new invite is needed.' },
        { status: 400 }
      );
    }

    // ── Guard 2: block if the user already has an active org membership ───────
    // user_profiles mirrors auth.users 1:1 via the on_auth_user_created trigger,
    // so every auth user (including incomplete invitees) has a profile row.
    const { data: existingProfile, error: profileLookupError } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (profileLookupError) {
      return NextResponse.json(
        { success: false, error: 'Failed to look up user profile' },
        { status: 500 }
      );
    }

    if (existingProfile) {
      // Look at ALL of this user's memberships, not just the current org. A user
      // active in ANY org — or a platform admin — is a real, onboarded account,
      // never a stale invite, so we must not delete/recreate it below.
      const { data: memberships, error: membershipsError } = await supabaseAdmin
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', existingProfile.id);

      if (membershipsError) {
        return NextResponse.json(
          { success: false, error: 'Failed to check organization membership' },
          { status: 500 }
        );
      }

      if ((memberships ?? []).some((m) => m.organization_id === organizationId)) {
        return NextResponse.json(
          { success: false, error: 'This user already has an active account in this organization.' },
          { status: 400 }
        );
      }

      const { data: platformAdmin, error: platformAdminError } = await supabaseAdmin
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', existingProfile.id)
        .maybeSingle();

      if (platformAdminError) {
        return NextResponse.json(
          { success: false, error: 'Failed to verify the account for this email' },
          { status: 500 }
        );
      }

      // Active in another org or platform staff → a real account. Block here
      // instead of falling through to the "stale invitee" cleanup below, which
      // would try to DELETE this live user — the "Database error deleting user"
      // the admin hit, and a destructive bug had the FK delete actually succeeded.
      if ((memberships ?? []).length > 0 || platformAdmin) {
        return NextResponse.json(
          {
            success: false,
            error:
              'This email already belongs to a Nexxus account, so it can’t be invited as a new team member here.',
          },
          { status: 400 }
        );
      }
    }

    // ── Supersede any existing pending/creating/expired/failed invites ───────
    // for this email+org. Replaces the hard block on re-invite; old rows are
    // kept for audit trail. Including 'expired' and 'failed' here means the
    // admin "Resend" button stops re-appearing on the old row after refresh
    // — only the freshly-created invite shows up as the active one.
    const { error: supersededError } = await supabaseAdmin
      .from('invites')
      .update({ status: 'superseded' })
      .eq('email', normalizedEmail)
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'creating', 'expired', 'failed']);

    if (supersededError) {
      return NextResponse.json(
        { success: false, error: 'Failed to supersede prior invites: ' + supersededError.message },
        { status: 500 }
      );
    }

    // ── Delete the prior incomplete invitee's auth user ──────────────────────
    // Only reached when the existing profile has NO membership in any org and
    // isn't a platform admin (Guard 2 above blocked every real account) — i.e. a
    // previous invite that was never completed. inviteUserByEmail can't reuse an
    // existing email, so clear it first. Cascades to user_profiles.
    if (existingProfile) {
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(
        existingProfile.id
      );

      if (deleteAuthError) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Failed to clear a prior incomplete invite for this email: ' + deleteAuthError.message,
          },
          { status: 500 }
        );
      }
    }

    // ── Insert invite row as 'creating' (locks the slot before email send) ────
    const { data: inviteData, error: inviteDataError } = await supabaseAdmin
      .from('invites')
      .insert({
        organization_id: organizationId,
        email: normalizedEmail,
        role,
        status: 'creating',
        accepted_at: null,
        invited_by: verified.userId,
      })
      .select()
      .single();

    if (inviteDataError || !inviteData) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create invite record: ' + (inviteDataError?.message ?? 'no data returned'),
        },
        { status: 500 }
      );
    }

    // ── Send the Supabase invite email ────────────────────────────────────────
    // Include invite_id in the redirect so the accept page can mark the
    // invite expired if the user clicks the email link a second time
    // (Supabase preserves query params on otp_expired error redirects too).
    const { data: supabaseInvite, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { redirectTo: `${process.env.APP_URL}/accept-invite?invite_id=${inviteData.id}` }
    );

    if (inviteError || !supabaseInvite) {
      // Mark the row as failed so it doesn't block future invite attempts.
      await supabaseAdmin
        .from('invites')
        .update({ status: 'failed' })
        .eq('id', inviteData.id);

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to send invite: ' + (inviteError?.message ?? 'no invite data returned'),
        },
        { status: 500 }
      );
    }

    // ── Promote row to 'pending' now that email was sent successfully ─────────
    const { error: promoteError } = await supabaseAdmin
      .from('invites')
      .update({ status: 'pending', sent_at: new Date().toISOString() })
      .eq('id', inviteData.id);

    if (promoteError) {
      // Email was sent — the invite will work. Log the promotion failure but
      // don't surface it as an error. The 'creating' row is non-blocking and
      // will be superseded on the next invite attempt if needed.
      console.error('Failed to promote invite row to pending:', promoteError);
    }

    return NextResponse.json(
      { success: true, invite: { ...inviteData, status: 'pending' } },
      { status: 200 }
    );

  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
