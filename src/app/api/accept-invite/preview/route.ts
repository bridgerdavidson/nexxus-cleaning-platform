import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessToken } = body;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'Missing access token.' },
        { status: 400 }
      );
    }

    // Resolve the auth user from the invite token
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'Invalid or expired invite token. Please request a new invite.' },
        { status: 401 }
      );
    }

    const email = user.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'No email associated with this invite token.' },
        { status: 400 }
      );
    }

    // Look up the pending invite using supabaseAdmin to bypass RLS
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('invites')
      .select('id, email, role, organization_id, status, expiration_date, opened_at, created_at, organizations(name)')
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (inviteError) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'Failed to look up invite. Please try again or contact support.' },
        { status: 500 }
      );
    }

    if (!invite) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'This invite has already been used or is no longer valid.' },
        { status: 404 }
      );
    }

    // Check expiration using expiration_date column. Flip the row to
    // 'expired' so the admin UI reflects reality on the next read.
    const now = new Date();
    if (invite.expiration_date && new Date(invite.expiration_date) < now) {
      await supabaseAdmin
        .from('invites')
        .update({ status: 'expired' })
        .eq('id', invite.id)
        .eq('status', 'pending');
      return NextResponse.json(
        { success: false, status: 'expired', message: 'This invite has expired. Please ask an admin to send a new invite.' },
        { status: 200 }
      );
    }

    // Record the first time this invite's form was loaded by the recipient.
    // Used by the lazy-expire job in /api/invites to flip abandoned invites
    // (opened but never accepted) to 'expired' once the access_token would
    // have expired (~1h after opening).
    if (!invite.opened_at) {
      await supabaseAdmin
        .from('invites')
        .update({ opened_at: now.toISOString() })
        .eq('id', invite.id)
        .is('opened_at', null);
    }

    // Return only safe fields needed to render the acceptance form
    const orgRaw = invite.organizations as unknown as { name: string } | { name: string }[] | null;
    const orgName = Array.isArray(orgRaw) ? (orgRaw[0]?.name ?? null) : (orgRaw?.name ?? null);

    return NextResponse.json({
      success: true,
      status: 'valid',
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        organizationId: invite.organization_id,
        organizationName: orgName,
      },
    }, { status: 200 });

  } catch (error) {
    return NextResponse.json(
      { success: false, status: 'invalid', message: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
