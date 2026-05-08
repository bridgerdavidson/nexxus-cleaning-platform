import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase-admin';

// Called by the accept-invite page when Supabase redirects back with an
// otp_expired error and we know the invite_id from the redirect URL. Flips
// the row from 'pending' to 'expired' so the admin UI reflects that the
// magic link has been consumed and is no longer usable.
//
// Intentionally unauthenticated: the invite_id is the auth (only the admin
// who sent it and the recipient who got the email know it), and the only
// state change available is pending → expired, which is recoverable by
// resending. We do NOT 404 on a non-pending row to avoid leaking which ids
// are valid.
//
// Guard: only flip when opened_at IS NULL. If the recipient already loaded
// the accept-invite form (preview set opened_at), they have an active form
// session — a *second* fetch of the URL (a re-tap, mail-client pre-fetch,
// safe-link scanner, link-preview gesture) must not invalidate the row out
// from under them. Genuinely abandoned invites are still cleaned up by the
// opened_at < (now-1h) lazy-expire pass in GET /api/invites.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing invite id' },
        { status: 400 }
      );
    }

    // Only flip if currently pending AND the recipient has not yet loaded
    // the accept form. See file header for the opened_at guard rationale.
    const { error } = await supabaseAdmin
      .from('invites')
      .update({ status: 'expired' })
      .eq('id', id)
      .eq('status', 'pending')
      .is('opened_at', null);

    if (error) {
      return NextResponse.json(
        { success: false, error: 'Failed to mark invite expired' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
