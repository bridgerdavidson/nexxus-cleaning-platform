import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeChecklist } from '@/lib/catalog/authorizeCatalog';
import { parseItemsCreate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/checklists/:id/items
 * Adds one task ({ task }) or many ({ tasks }). `position` is left null on
 * purpose: the client sort places null positions last by created_at, so new
 * tasks read as appended without jumping above the trigger-seeded default
 * items, which also have null positions.
 * Returns 201 { success: true, data: ChecklistLineItem[] } in the order given.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseItemsCreate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('checklist_line_items')
      .insert(parsed.value.tasks.map((task) => ({ checklist_id: id, task })))
      .select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data: data ?? [] }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
