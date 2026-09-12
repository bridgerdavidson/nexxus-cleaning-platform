import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeLineItem } from '@/lib/catalog/authorizeCatalog';
import { parseItemUpdate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ itemId: string }> };

/**
 * PATCH /api/checklist-items/:itemId
 * Body: { task }. The org is resolved from the item itself (item -> checklist
 * -> service), which is why this route is keyed by item id alone.
 * Returns { success: true, data: ChecklistLineItem }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { itemId } = await params;
    const auth = await authorizeLineItem(request, itemId);
    if (!auth.ok) return auth.response;

    const parsed = parseItemUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('checklist_line_items')
      .update({ task: parsed.value.task })
      .eq('id', itemId)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to update task' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/** DELETE /api/checklist-items/:itemId. Returns { success: true }. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { itemId } = await params;
    const auth = await authorizeLineItem(request, itemId);
    if (!auth.ok) return auth.response;

    const { error } = await supabaseAdmin.from('checklist_line_items').delete().eq('id', itemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
