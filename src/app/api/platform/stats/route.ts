import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import type { PlatformStats } from '@/types/platform';

/**
 * GET /api/platform/stats
 *
 * Platform-wide overview metrics (tenant/plan counts, platform fees collected,
 * GMV, appointments, new tenants) in one round trip via the `platform_stats()`
 * RPC (SECURITY DEFINER, service-role only). Authorization is enforced here with
 * requirePlatformAdmin; the RPC has no auth.uid() context.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin.rpc('platform_stats');
  if (error) {
    return NextResponse.json(
      { error: 'Failed to load platform stats', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ stats: data as PlatformStats });
}
