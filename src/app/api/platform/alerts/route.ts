import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import type { PlatformAlert } from '@/types/platform';

// Service-role admin client; nothing edge-specific.
export const runtime = 'nodejs';

/**
 * GET /api/platform/alerts
 *
 * Platform-owner operational alert outbox (public.platform_alerts, migration 085),
 * newest-first by last_seen_at. `?status=open|resolved|all` (default open) and
 * limit/offset paging; returns `nextOffset` for load-more (null on the last page).
 * Guarded by requirePlatformAdmin (platform staff only); reads via the service role.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const status = params.get('status') ?? 'open';
  // An unknown status used to silently fall through to "all" — reject it instead so a typo can't
  // read as a broader result set.
  if (status !== 'open' && status !== 'resolved' && status !== 'all') {
    return NextResponse.json(
      { error: '`status` must be open, resolved, or all' },
      { status: 400 },
    );
  }
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 100);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);

  let query = supabaseAdmin
    .from('platform_alerts')
    .select(
      'id, alert_type, severity, summary, details, occurrences, first_seen_at, last_seen_at, resolved_at',
    )
    // last_seen_at is the incident recency; id is the tiebreaker so rows sharing a
    // timestamp can't duplicate or skip across page boundaries.
    .order('last_seen_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit); // fetch limit + 1 to detect a next page

  if (status === 'open') query = query.is('resolved_at', null);
  else if (status === 'resolved') query = query.not('resolved_at', 'is', null);
  // status === 'all' → no filter

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'Failed to load platform alerts', details: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as PlatformAlert[];
  const alerts = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  return NextResponse.json({ alerts, nextOffset: hasMore ? offset + limit : null });
}
