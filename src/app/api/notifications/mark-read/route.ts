import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';

/**
 * Mark the caller's in-app notifications as read (sets in_app_dispatched_at).
 *
 * notification_events has a SELECT-only RLS policy (recipient reads own rows), so
 * clients cannot UPDATE it directly. This service-role route is the only client
 * writer of in_app_dispatched_at, and it ALWAYS constrains the update to
 * recipient_user_id = <verified caller> so a user can never mark another user's
 * rows. It only ever touches in_app_dispatched_at — the SMS/email dispatcher's
 * sms_dispatched_at / email_dispatched_at columns are left untouched.
 *
 *   POST { ids?: string[] }  → mark those ids read; omit `ids` to mark ALL unread.
 */
function bearer(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  return authHeader?.replace(/^Bearer\s+/i, '').trim() || null;
}

export async function POST(request: NextRequest) {
  try {
    const token = bearer(request);
    if (!token) return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });

    const verified = await verifyAccessToken(supabaseAdmin, token);
    if (!verified) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });

    const body = await request.json().catch(() => ({} as unknown));

    // Distinguish "ids absent" (intentional mark-all) from "ids present but
    // malformed" (e.g. a client serialization bug sending a bare string). The
    // latter must NOT silently fall through to mark-all and wipe the feed.
    const hasIdsField =
      typeof body === 'object' &&
      body !== null &&
      'ids' in body &&
      (body as { ids?: unknown }).ids !== undefined;

    let ids: string[] | null = null;
    if (hasIdsField) {
      const rawIds = (body as { ids?: unknown }).ids;
      if (!Array.isArray(rawIds) || !rawIds.every((v) => typeof v === 'string')) {
        return NextResponse.json({ error: 'ids must be an array of strings' }, { status: 400 });
      }
      // Explicit empty list: nothing to mark (do NOT fall through to mark-all).
      if (rawIds.length === 0) {
        return NextResponse.json({ success: true, updated: 0 });
      }
      ids = rawIds;
    }

    let query = supabaseAdmin
      .from('notification_events')
      .update({ in_app_dispatched_at: new Date().toISOString() })
      .eq('recipient_user_id', verified.userId)
      .is('in_app_dispatched_at', null);

    if (ids) {
      query = query.in('id', ids);
    }

    const { data, error } = await query.select('id');
    if (error) {
      console.error('Failed to mark notifications read:', error);
      return NextResponse.json({ error: 'Failed to mark notifications read' }, { status: 500 });
    }

    return NextResponse.json({ success: true, updated: (data ?? []).length });
  } catch (error) {
    console.error('Error marking notifications read:', error);
    return NextResponse.json(
      {
        error: 'Failed to mark notifications read',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
