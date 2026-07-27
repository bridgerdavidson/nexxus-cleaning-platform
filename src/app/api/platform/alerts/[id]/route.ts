import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/platform/alerts/[id]  { resolved: boolean }
 *
 * Resolve (clear) or reopen a platform alert. Platform-owner only. `resolved: true`
 * stamps resolved_at (so the open-incident dedupe in recordPlatformAlert starts a
 * fresh row on the next occurrence); `resolved: false` clears it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  // A non-UUID id would otherwise surface as a Postgres cast error (500); it's a caller bug (400).
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid alert id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  // A literal `null` (or any non-object) parses as valid JSON — guard the shape, not just the parse.
  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { resolved } = body as { resolved?: unknown };
  if (typeof resolved !== 'boolean') {
    return NextResponse.json({ error: '`resolved` must be a boolean' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('platform_alerts')
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    // Reopening collides with the open-incident unique index (migration 115) when a newer open
    // row of the same alert_type already exists — a caller conflict, not a server failure.
    if (!resolved && error.code === '23505') {
      return NextResponse.json(
        { error: 'An open incident of this type already exists. Resolve it before reopening this one.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to update alert', details: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
