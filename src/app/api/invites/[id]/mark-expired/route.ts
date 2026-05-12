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
// Guard: only flip when EITHER the recipient has not yet loaded the form
// (opened_at IS NULL) OR they explicitly closed it (form_closed_at IS NOT
// NULL, set by a pagehide sendBeacon from the accept-invite page while in
// pageState='valid'). This preserves the protection that a *second* fetch
// of the URL (re-tap mid-fill, mail-client pre-fetch, JS-executing safe-
// link scanner, link-preview gesture) cannot invalidate a row whose
// recipient is actively filling out the form, while still letting a
// genuine close → re-click flip pending → expired immediately so the
// admin UI reflects reality via realtime. The opened_at < (now-1h) lazy
// expire in GET /api/invites remains the fallback when pagehide didn't
// fire (force-quit, OS crash, etc.).

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

    // Only flip if currently pending AND either the recipient has not yet
    // loaded the form OR they explicitly closed it. See file header for
    // the full guard rationale.
    const { error } = await supabaseAdmin
      .from('invites')
      .update({ status: 'expired' })
      .eq('id', id)
      .eq('status', 'pending')
      .or('opened_at.is.null,form_closed_at.not.is.null');

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
