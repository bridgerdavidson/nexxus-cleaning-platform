import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';

/**
 * POST /api/platform/impersonation
 *
 * Records a platform-admin "View as" start/end in platform_audit_log. The actual
 * cross-tenant read access is granted by the SELECT-only RLS predicate (069);
 * this endpoint exists purely so every entry/exit is auditable.
 *
 * Body: { action: 'start' | 'end', organization_id }
 */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    organization_id?: string;
  };

  if (!body.organization_id) {
    return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
  }
  const action = body.action === 'end' ? 'impersonation_end' : 'impersonation_start';

  const { error } = await supabaseAdmin.from('platform_audit_log').insert({
    actor_user_id: auth.userId,
    action,
    target_org_id: body.organization_id,
  });

  if (error) {
    return NextResponse.json(
      { error: 'Failed to record audit entry', details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
