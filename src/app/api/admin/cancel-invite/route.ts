import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * Cancel (revoke) a pending team invite. The invites enum has always had a
 * `revoked` value but nothing wrote it; this is the first path that does.
 * Idempotent: only non-terminal invites flip to revoked, so re-calling on an
 * already accepted/superseded/revoked invite is a no-op success.
 */
export async function POST(request: NextRequest) {
  try {
    const { inviteId, organizationId } = (await request.json()) ?? {};
    if (!inviteId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'inviteId and organizationId are required' },
        { status: 400 },
      );
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    if (auth.role === 'manager') {
      const { data: perms, error: permsErr } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_manage_cleaners')
        .eq('manager_id', auth.userId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (permsErr) {
        return NextResponse.json({ success: false, error: 'Failed to check manager permissions' }, { status: 500 });
      }
      if (perms?.can_manage_cleaners !== true) {
        return NextResponse.json({ success: false, error: 'Not authorized to manage cleaners' }, { status: 403 });
      }
    }

    const { error } = await supabaseAdmin
      .from('invites')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', inviteId)
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'creating', 'failed', 'expired']);
    if (error) {
      return NextResponse.json({ success: false, error: `Failed to cancel invite: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
