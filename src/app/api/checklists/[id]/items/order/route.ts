import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeChecklist } from '@/lib/catalog/authorizeCatalog';
import { orderMatchesItems, parseOrder } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/checklists/:id/items/order
 * Body: { item_ids: string[] }, a permutation of the checklist's items. Writes
 * position = index for each (sequentially, as the client did) and returns the
 * items ordered by the new positions: { success: true, data: ChecklistLineItem[] }.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseOrder(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data: existing, error: loadError } = await supabaseAdmin
      .from('checklist_line_items')
      .select('id')
      .eq('checklist_id', id);
    if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
    const existingIds = (existing ?? []).map((row) => row.id as string);
    if (!orderMatchesItems(parsed.value.item_ids, existingIds)) {
      return NextResponse.json(
        { error: 'item_ids must list every task in this checklist exactly once' },
        { status: 400 },
      );
    }

    for (const [index, itemId] of parsed.value.item_ids.entries()) {
      const { error } = await supabaseAdmin
        .from('checklist_line_items')
        .update({ position: index })
        .eq('id', itemId)
        .eq('checklist_id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data, error } = await supabaseAdmin
      .from('checklist_line_items')
      .select('*')
      .eq('checklist_id', id)
      .order('position', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
