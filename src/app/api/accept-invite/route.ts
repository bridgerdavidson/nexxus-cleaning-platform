import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { STANDARD_MANAGER_PRESET, coerceManagerPermissions } from '@/lib/permissions/managerFlags';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessToken, inviteId, firstName, lastName, phone, password } = body;

    // Prefer the standard Authorization header; fall back to the body token for
    // backward compatibility with older clients. Either way the token is verified
    // below — body-transported tokens are more likely to land in request logs.
    const headerToken = request.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    const token = headerToken || accessToken;

    if (!token || !inviteId || !firstName || !lastName || !password) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify the token and get the caller. Prefers local getClaims verification
    // (no GoTrue /user round-trip on asymmetric signing keys), falling back to
    // getUser otherwise.
    const verified = await verifyAccessToken(supabaseAdmin, token);

    if (!verified) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session. Please request a new invite.' },
        { status: 401 }
      );
    }

    const email = verified.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'No email associated with this invite token.' },
        { status: 400 }
      );
    }

    // Re-validate invite server-side by id — never trust the client's preview
    // result. Looking up by id (instead of email + status='pending') lets us
    // inspect the actual current status and return a specific error per state.
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('invites')
      .select('id, email, role, organization_id, status, expiration_date, manager_permissions')
      .eq('id', inviteId)
      .maybeSingle();

    if (inviteError) {
      return NextResponse.json(
        { success: false, error: 'Failed to look up invite: ' + inviteError.message },
        { status: 500 }
      );
    }

    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'Invite not found. Please ask an admin to send a new invite.' },
        { status: 400 }
      );
    }

    // Email sanity check — prevents accepting an invite issued to someone else.
    if (invite.email !== email) {
      return NextResponse.json(
        { success: false, error: 'This invite was issued to a different address.' },
        { status: 400 }
      );
    }

    // Status-specific handling. Only 'pending' continues; everything else
    // returns an actionable message describing the actual state.
    switch (invite.status) {
      case 'pending':
        break;
      case 'accepted':
        return NextResponse.json(
          { success: false, error: 'This invite has already been used. Please sign in instead.' },
          { status: 400 }
        );
      case 'superseded':
        return NextResponse.json(
          { success: false, error: 'A newer invite was sent. Please use the most recent link from your inbox.' },
          { status: 400 }
        );
      case 'expired':
        return NextResponse.json(
          { success: false, error: 'This invite has expired. Please ask an admin to send a new invite.' },
          { status: 400 }
        );
      case 'failed':
        return NextResponse.json(
          { success: false, error: 'This invite failed to send. Please ask an admin to send a new invite.' },
          { status: 400 }
        );
      case 'creating':
        return NextResponse.json(
          { success: false, error: 'This invite is still being prepared. Please try again in a moment.' },
          { status: 400 }
        );
      default:
        return NextResponse.json(
          { success: false, error: 'This invite is no longer valid.' },
          { status: 400 }
        );
    }

    // Check expiration using the expiration_date column set at invite creation
    if (invite.expiration_date && new Date(invite.expiration_date) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'This invite has expired. Please ask an admin to send a new one.' },
        { status: 400 }
      );
    }

    const { role, organization_id: organizationId } = invite;

    // OrgRole 'owner' has no UserRole equivalent (UserRole is
    // homeowner|cleaner|manager|admin) — a cleaning-company owner uses the admin
    // dashboard. Keep the raw `role` for organization_members (in-org permissions);
    // use the mapped UserRole for auth.app_metadata + user_profiles, which drive
    // dashboard routing and the app_metadata.role-based RLS policies.
    const userProfileRole = role === 'owner' ? 'admin' : role;

    // Set password, role, and display name in auth.users. app_metadata.role
    // mirrors user_profiles.role so the AuthContext fallback path (used when
    // the user_profiles SELECT errors/times out/aborts) returns the correct
    // role instead of defaulting to 'homeowner'.
    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(verified.userId, {
      password,
      app_metadata: { role: userProfileRole },
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`,
      },
    });

    if (updateAuthError) {
      return NextResponse.json(
        { success: false, error: 'Failed to set password: ' + updateAuthError.message },
        { status: 500 }
      );
    }

    // Create / update the user profile
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        id: verified.userId,
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        role: userProfileRole,
      }, { onConflict: 'id' });

    if (profileError) {
      return NextResponse.json(
        { success: false, error: 'Failed to create user profile: ' + profileError.message },
        { status: 500 }
      );
    }

    // Create organization membership
    const { error: membershipError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: organizationId,
        user_id: verified.userId,
        role,
      });

    if (membershipError) {
      return NextResponse.json(
        { success: false, error: 'Failed to create organization membership: ' + membershipError.message },
        { status: 500 }
      );
    }

    // If the invited user is a cleaner, create their cleaner profile
    if (role === 'cleaner') {
      const { error: cleanerProfileError } = await supabaseAdmin
        .from('cleaner_profiles')
        .insert({
          id: verified.userId,
          organization_id: organizationId,
        });

      if (cleanerProfileError) {
        console.error('Failed to create cleaner profile:', cleanerProfileError);
        // Non-fatal — log and continue
      }
    }

    // If the invited user is a manager, seed manager_permissions from whatever the
    // inviter chose on the invite (invite.manager_permissions), falling back to the
    // Standard manager preset for legacy/NULL invites. Do NOT default to all-true —
    // the preset intentionally leaves 5 flags off.
    if (role === 'manager') {
      const seededPerms = invite.manager_permissions
        ? coerceManagerPermissions(invite.manager_permissions as Record<string, unknown>)
        : STANDARD_MANAGER_PRESET;

      const { error: managerPermissionsError } = await supabaseAdmin
        .from('manager_permissions')
        .upsert(
          {
            manager_id: verified.userId,
            organization_id: organizationId,
            ...seededPerms,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'manager_id,organization_id' }
        );

      if (managerPermissionsError) {
        console.error('Failed to create manager permissions:', managerPermissionsError);
        // Non-fatal — log and continue
      }
    }

    // Mark invite as accepted — only after all records are created successfully
    const { error: acceptError } = await supabaseAdmin
      .from('invites')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', inviteId);

    if (acceptError) {
      console.error('Failed to mark invite as accepted:', acceptError);
      // Non-fatal — profile is already created; log and continue
    }

    // Notify the org's owners, admins, and managers that a new member joined.
    // Best-effort (the helper swallows its own errors) and excludes the joiner
    // themselves from the fan-out so they don't get notified of their own join.
    const joinerName = `${firstName} ${lastName}`.trim() || email;
    await recordNotificationEvent(supabaseAdmin, {
      event_type: 'member_joined',
      organization_id: organizationId,
      recipient_roles: ['owner', 'admin', 'manager'],
      exclude_user_ids: [verified.userId],
      payload: { audience: 'admin', member_name: joinerName, member_role: role },
    });

    return NextResponse.json({ success: true, role: userProfileRole }, { status: 200 });

  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
