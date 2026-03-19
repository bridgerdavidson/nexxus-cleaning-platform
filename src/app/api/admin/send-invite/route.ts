import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, role, organizationId } = body;
    
    // Validate user is logged in and get id
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }
    
    const {data: {user}, error: userError} = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'Failed to get user' },
        { status: 401 }
      );
    }

    // authorize caller
    const { data: membership, error: membershipError } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .maybeSingle();

    if (membershipError)
    {
      return NextResponse.json(
        { success: false, error: 'Failed to get membership' },
        { status: 401 }
      );
    }

    if (!membership)
    {
      return NextResponse.json(
        { success: false, error: 'User is not a member of the organization' },
        { status: 401 }
      );
    }
    if (membership.role !== 'admin'){
      return NextResponse.json(
        { success: false, error: 'User is not an admin' },
        { status: 401 }
      );
    }

    // Validate inputs
    if (!email || !role || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Normalize email once — aligns with invites_email_lowercase DB constraint
    const normalizedEmail = email.trim().toLowerCase();

    if (!['cleaner', 'manager', 'admin'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role. Must be "cleaner" or "manager" or "admin"' },
        { status: 400 }
      );
    }

    // Check if email exists in auth.users
    const {
      data: usersData,
      error: emailCheckUserError,
    } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 100,
    });

    const emailCheckUser =
  usersData?.users?.find(
    (u) => u.email && u.email.toLowerCase() === normalizedEmail,
  ) ?? null;

    if (emailCheckUserError)
    {
      return NextResponse.json(
        { success: false, error: 'Failed to check if email exists: ' + emailCheckUserError.message },
        { status: 401 }
      );
    }

    if (emailCheckUser)
    {
      return NextResponse.json(
        { success: false, error: 'Email already exists' },
        { status: 400 }
      );
    }

    // Check if there is a pending invite for this email
    const { data: pendingInvite, error: pendingInviteError } = await supabaseAdmin
    .from('invites')
    .select('*')
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .maybeSingle();
    if (pendingInviteError)
    {
      return NextResponse.json(
        { success: false, error: 'Failed to check for pending invite' },
        { status: 401 }
      );
    }
    if (pendingInvite)
    {
      return NextResponse.json(
        { success: false, error: 'Email already has a pending invite' },
        { status: 400 }
      );
    }

    // Create invite record
    const {data: inviteData, error: inviteDataError} = await supabaseAdmin
    .from('invites')
    .insert({
      organization_id: organizationId,
      email: normalizedEmail,
      role,
      status: 'pending',
      accepted_at: null,
      invited_by: user.id,
    })
    .select()
    .single();
    
    if (inviteDataError)
    {
      return NextResponse.json(
        { success: false, error: 'Failed to create invite record: ' + inviteDataError.message },
        { status: 401 }
      );
    }

    if (!inviteData)
    {
      return NextResponse.json(
        { success: false, error: 'Failed to create invite record: No invite data returned' },
        { status: 401 }
      );
    }

    // Send invite
    const {data: invite, error: inviteError} = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: `${process.env.APP_URL}/accept-invite`,
    });

    if (inviteError)
    {
      return NextResponse.json(
        { success: false, error: 'Failed to send invite: ' + inviteError.message },
        { status: 401 }
      );
    }
    if (!invite)
    {
      return NextResponse.json(
        { success: false, error: 'Failed to send invite: No invite data returned' },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { success: true, invite: inviteData },
      { status: 200 }
    );

  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}

