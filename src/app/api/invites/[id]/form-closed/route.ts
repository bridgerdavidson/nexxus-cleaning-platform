import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase-admin';

// Called by the accept-invite page via navigator.sendBeacon on pagehide,
// but ONLY while the page is in the 'valid' state (form rendered to the
// recipient). Sets form_closed_at so a subsequent mark-expired call (e.g.
// the recipient re-clicks the now-consumed magic link) is allowed to flip
// pending → expired. See 051_invite_form_closed_at.sql and the mark-expired
// route header for the full guard rationale.
//
// Intentionally unauthenticated like mark-expired: the invite id is the
// auth, and the only state change available is setting form_closed_at on a
// pending row whose recipient already loaded the form. Returns 200 in all
// non-error cases — sendBeacon doesn't inspect the response anyway.

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

    // Only set when pending AND the recipient has loaded the form. The
    // opened_at IS NOT NULL clause is defense-in-depth: realistically the
    // beacon only fires from pageState='valid' which implies preview ran
    // and set opened_at, but a malformed call without that precondition
    // shouldn't be able to pre-arm mark-expired.
    await supabaseAdmin
      .from('invites')
      .update({ form_closed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .not('opened_at', 'is', null)
      .is('form_closed_at', null);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
