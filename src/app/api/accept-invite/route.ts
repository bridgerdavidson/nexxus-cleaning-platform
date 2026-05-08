import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessToken, inviteId, firstName, lastName, phone, password } = body;

    if (!accessToken || !inviteId || !firstName || !lastName || !password) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify the token and get the user
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session. Please request a new invite.' },
        { status: 401 }
      );
    }

    const email = user.email?.trim().toLowerCase();
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
      .select('id, email, role, organization_id, status, expiration_date')
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

    // Set password and update display name in auth.users
    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
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
        id: user.id,
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        role,
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
        user_id: user.id,
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
          id: user.id,
          organization_id: organizationId,
        });

      if (cleanerProfileError) {
        console.error('Failed to create cleaner profile:', cleanerProfileError);
        // Non-fatal — log and continue
      }
    }

    // If the invited user is a manager, grant full default manager permissions
    if (role === 'manager') {
      const { error: managerPermissionsError } = await supabaseAdmin
        .from('manager_permissions')
        .upsert(
          {
            manager_id: user.id,
            organization_id: organizationId,
            can_view_customers: true,
            can_edit_customers: true,
            can_view_bookings: true,
            can_edit_bookings: true,
            can_approve_decline_bookings: true,
            can_manage_cleaners: true,
            can_view_properties: true,
            can_edit_properties: true,
            can_view_analytics: true,
            can_view_payments: true,
            can_manage_payments: true,
            can_view_messages: true,
            can_view_services: true,
            can_manage_services: true,
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

    return NextResponse.json({ success: true, role }, { status: 200 });

  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
