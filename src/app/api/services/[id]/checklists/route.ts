import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeService } from '@/lib/catalog/authorizeCatalog';
import { parseChecklistCreate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/services/:id/checklists
 * Creates a checklist (tier) on a service with its items in the given order.
 * Body: { name?, price_adder?, items?: string[] }.
 * Returns 201 { success: true, data: ChecklistWithItems }. If the items insert
 * fails the checklist is deleted again and the error is returned.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeService(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseChecklistCreate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const { data: checklist, error: clError } = await supabaseAdmin
      .from('checklists')
      .insert({ service_type_id: id, name: input.name, price_adder: input.price_adder })
      .select('*')
      .single();
    if (clError || !checklist) {
      return NextResponse.json({ error: clError?.message ?? 'Failed to create checklist' }, { status: 500 });
    }

    let items: unknown[] = [];
    if (input.items.length > 0) {
      const { data: inserted, error: itemsError } = await supabaseAdmin
        .from('checklist_line_items')
        .insert(input.items.map((task, idx) => ({ checklist_id: checklist.id, task, position: idx })))
        .select('*')
        .order('position', { ascending: true });
      if (itemsError) {
        await supabaseAdmin.from('checklists').delete().eq('id', checklist.id);
        return NextResponse.json({ error: itemsError.message }, { status: 500 });
      }
      items = inserted ?? [];
    }

    return NextResponse.json(
      { success: true, data: { ...checklist, checklist_line_items: items } },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
