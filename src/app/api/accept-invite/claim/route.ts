import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/accept-invite/claim   { inviteId }
 *
 * Mints a fresh GoTrue token_hash for a still-valid invite at the moment the
 * recipient clicks Continue on the accept page. Invite emails deliberately
 * carry NO consumable token (mail scanners GET every emailed URL, and a GET on
 * the single-use GoTrue action link consumed the OTP before the human clicked:
 * the recurring "invite expired on first click" pilot bug, 2026-08-18), and
 * the GoTrue OTP lifetime is minutes-to-hours while invites.expiration_date is
 * 7 days. Minting at click time makes the emailed link live exactly as long as
 * the invite row.
 *
 * Authorization is bearer-by-invite-id: the uuid is unguessable and emailed
 * only to the invitee, the same trust model as the card-collection links
 * (/api/billing/card-links) and the mark-expired/form-closed invite routes.
 * The invite row must still be pending and unexpired.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { inviteId?: unknown };
    const inviteId = typeof body.inviteId === 'string' ? body.inviteId : '';
    if (!inviteId) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'Missing invite id.' },
        { status: 400 },
      );
    }

    const { data: invite, error } = await supabaseAdmin
      .from('invites')
      .select('id, email, status, expiration_date')
      .eq('id', inviteId)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'Failed to look up invite. Please try again.' },
        { status: 500 },
      );
    }
    if (!invite) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'This invite has already been used or is no longer valid.' },
        { status: 404 },
      );
    }

    // Same status copy as /api/accept-invite/preview so both gates read alike.
    if (invite.status !== 'pending') {
      const messageByStatus: Record<string, string> = {
        accepted: 'This invite has already been used. Please sign in.',
        superseded: 'A newer invite was sent. Please use the most recent link from your inbox.',
        expired: 'This invite has expired. Please ask an admin to send a new invite.',
        failed: 'This invite failed to send. Please ask an admin to send a new invite.',
        creating: 'This invite is still being prepared. Please refresh in a moment.',
      };
      const responseStatus: 'expired' | 'invalid' = invite.status === 'expired' ? 'expired' : 'invalid';
      return NextResponse.json(
        {
          success: false,
          status: responseStatus,
          message: messageByStatus[invite.status] ?? 'This invite is no longer valid.',
        },
        { status: 200 },
      );
    }

    // Flip a lapsed row to 'expired' so the admin UI reflects reality (same
    // lazy-expire behavior as the preview route and /api/invites).
    if (invite.expiration_date && new Date(invite.expiration_date) < new Date()) {
      await supabaseAdmin
        .from('invites')
        .update({ status: 'expired' })
        .eq('id', invite.id)
        .eq('status', 'pending');
      return NextResponse.json(
        { success: false, status: 'expired', message: 'This invite has expired. Please ask an admin to send a new invite.' },
        { status: 200 },
      );
    }

    // Fresh single-use token for the invited user. 'invite' covers the normal
    // case (user created at send time, never signed in). GoTrue refuses to
    // re-invite an email it considers registered (e.g. a prior claim verified
    // but the form was abandoned), so fall back to a magiclink token, which
    // signs an existing user in the same way; the page passes the returned
    // type straight to verifyOtp.
    let verificationType: 'invite' | 'magiclink' = 'invite';
    let linkRes = await supabaseAdmin.auth.admin.generateLink({ type: 'invite', email: invite.email });
    if (linkRes.error || !linkRes.data?.properties?.hashed_token) {
      verificationType = 'magiclink';
      linkRes = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email: invite.email });
    }
    const tokenHash = linkRes.data?.properties?.hashed_token;
    if (linkRes.error || !tokenHash) {
      return NextResponse.json(
        { success: false, status: 'invalid', message: 'Could not prepare your sign-in. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, tokenHash, verificationType });
  } catch (error) {
    return NextResponse.json(
      { success: false, status: 'invalid', message: 'Internal server error: ' + (error as Error).message },
      { status: 500 },
    );
  }
}
