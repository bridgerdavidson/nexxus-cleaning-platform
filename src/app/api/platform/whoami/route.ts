import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';

/**
 * GET /api/platform/whoami
 *
 * Resolves the caller's platform-admin status. Returns 200 for a platform admin
 * and 403 otherwise (401 without a token). AuthContext calls this once per session
 * to set `isPlatformAdmin` — keeping platform-admin status server-resolved means
 * the `platform_admins` table needs no client-readable RLS policy.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (auth.ok) {
    return NextResponse.json({ isPlatformAdmin: true, userId: auth.userId });
  }
  // A valid token that simply isn't in `platform_admins` (403) is a normal,
  // definitive answer — "you're not a platform admin" — not an error. Return it
  // as 200 so it doesn't surface as a red console error on every dashboard load
  // for ordinary users, and so the client can safely cache it. Real errors
  // (401 missing/invalid token, 500 lookup failure) keep their original status
  // so the client does NOT cache them and can retry.
  if (auth.response.status === 403) {
    return NextResponse.json({ isPlatformAdmin: false });
  }
  return auth.response;
}
