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
  if (!auth.ok) return auth.response;
  return NextResponse.json({ isPlatformAdmin: true, userId: auth.userId });
}
