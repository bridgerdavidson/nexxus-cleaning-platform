import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import type { PlatformAuditEntry } from '@/types/platform';

interface AuditRow {
  id: string;
  actor_user_id: string;
  action: string;
  target_org_id: string | null;
  metadata: Record<string, unknown> | null;
  started_at: string;
  ended_at: string | null;
}
interface ProfileRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

async function fetchProfiles(ids: string[]): Promise<ProfileRow[]> {
  if (!ids.length) return [];
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('id, first_name, last_name, email')
    .in('id', ids);
  return (data ?? []) as ProfileRow[];
}

async function fetchOrgNames(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const { data } = await supabaseAdmin.from('organizations').select('id, name').in('id', ids);
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * GET /api/platform/audit
 *
 * Read-only platform audit trail (impersonations, provisions, deletes, Connect
 * resets) from platform_audit_log, newest-first. Actor + target-org names are
 * resolved in a single batched lookup per page (no per-row N+1). Supports
 * ?org_id= (scope to one tenant) and limit/offset paging; returns `nextOffset`
 * for load-more (null when the last page is reached).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const orgId = params.get('org_id');
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 100);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);

  let query = supabaseAdmin
    .from('platform_audit_log')
    .select('id, actor_user_id, action, target_org_id, metadata, started_at, ended_at')
    .order('started_at', { ascending: false })
    .range(offset, offset + limit); // fetch limit + 1 rows to detect a next page

  if (orgId) query = query.eq('target_org_id', orgId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'Failed to load audit log', details: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as AuditRow[];
  const pageRows = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  const actorIds = [...new Set(pageRows.map((r) => r.actor_user_id).filter(Boolean))];
  const orgIds = [...new Set(pageRows.map((r) => r.target_org_id).filter((v): v is string => !!v))];

  const [profiles, orgs] = await Promise.all([fetchProfiles(actorIds), fetchOrgNames(orgIds)]);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  const entries: PlatformAuditEntry[] = pageRows.map((r) => {
    const p = profileById.get(r.actor_user_id);
    const fullName = p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() : '';
    return {
      id: r.id,
      action: r.action,
      actor_name: fullName || p?.email || 'Unknown',
      actor_email: p?.email ?? null,
      target_org_id: r.target_org_id,
      target_org_name: r.target_org_id ? orgNameById.get(r.target_org_id) ?? null : null,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      started_at: r.started_at,
      ended_at: r.ended_at,
    };
  });

  return NextResponse.json({ entries, nextOffset: hasMore ? offset + limit : null });
}
