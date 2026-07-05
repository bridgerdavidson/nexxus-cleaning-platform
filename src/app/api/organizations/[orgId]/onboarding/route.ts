import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await params;

    const auth = await requireOrgAuth(request, orgId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { dismiss_setup_checklist?: boolean };
    if (body.dismiss_setup_checklist !== true) {
      return NextResponse.json({ error: 'dismiss_setup_checklist must be true' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ setup_checklist_dismissed_at: new Date().toISOString() })
      .eq('id', orgId);
    if (error) {
      return NextResponse.json({ error: 'Failed to dismiss checklist', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
