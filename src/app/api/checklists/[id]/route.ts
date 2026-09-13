import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeChecklist } from '@/lib/catalog/authorizeCatalog';
import { parseChecklistUpdate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/checklists/:id
 * Body: { name?, price_adder? }. Returns { success: true, data: Checklist }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseChecklistUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('checklists')
      .update(parsed.value)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to update checklist' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/checklists/:id
 * Deletes the checklist; its line items cascade. Returns { success: true }.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const { error } = await supabaseAdmin.from('checklists').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
