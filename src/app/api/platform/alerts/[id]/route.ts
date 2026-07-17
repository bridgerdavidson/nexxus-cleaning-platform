import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';

export const runtime = 'nodejs';

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

  let body: { resolved?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.resolved !== 'boolean') {
    return NextResponse.json({ error: '`resolved` must be a boolean' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('platform_alerts')
    .update({ resolved_at: body.resolved ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
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
