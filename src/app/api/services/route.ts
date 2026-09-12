import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { parseServiceCreate, type ChecklistSeed } from '@/lib/catalog/serviceInput';

export const runtime = 'nodejs';

/**
 * POST /api/services
 *
 * Creates a service (service_types row). Owner or admin, or a manager with
 * can_manage_services (the same flag migration 104 enforces in RLS).
 *
 * The insert fires create_default_checklist_for_service, which seeds a
 * "Default Checklist". When the body carries `checklists` (an array, even empty)
 * that seeded checklist is removed and the given checklists and items are
 * created in order; when the key is absent the default stays. A failure after
 * the service row exists deletes the service again (the cascade removes its
 * checklists) so a half-created service never lingers.
 *
 * Body: { organization_id, name, description?, base_price, duration_minutes,
 *         service_type, is_active?, checklists?: [{ name, price_adder, position?, items }] }
 * Returns 201 { success: true, data: ServiceType }.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = parseServiceCreate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const auth = await requireManagerPermission(
      request,
      input.organization_id,
      supabaseAdmin,
      'can_manage_services',
      { errorMessage: 'Requires the Manage services permission' },
    );
    if (!auth.ok) return auth.response;

    const { data: service, error: insertError } = await supabaseAdmin
      .from('service_types')
      .insert({
        organization_id: input.organization_id,
        name: input.name,
        description: input.description,
        base_price: input.base_price,
        duration_minutes: input.duration_minutes,
        service_type: input.service_type,
        is_active: input.is_active,
      })
      .select('*')
      .single();
    if (insertError || !service) {
      return NextResponse.json(
        { error: insertError?.message ?? 'Failed to create service' },
        { status: 500 },
      );
    }

    if (input.checklists !== undefined) {
      const seedError = await replaceChecklists(service.id as string, input.checklists);
      if (seedError) {
        await supabaseAdmin.from('service_types').delete().eq('id', service.id);
        return NextResponse.json({ error: seedError }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, data: service }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/** Drops the trigger-seeded checklist(s) and creates the seeds in order. Returns an error message, or null. */
async function replaceChecklists(serviceId: string, seeds: ChecklistSeed[]): Promise<string | null> {
  const { error: delError } = await supabaseAdmin
    .from('checklists')
    .delete()
    .eq('service_type_id', serviceId);
  if (delError) return delError.message;

  for (const seed of seeds) {
    const { data: checklist, error: clError } = await supabaseAdmin
      .from('checklists')
      .insert({
        service_type_id: serviceId,
        name: seed.name,
        price_adder: seed.price_adder,
        position: seed.position,
      })
      .select('id')
      .single();
    if (clError || !checklist) return clError?.message ?? 'Failed to create checklist';

    if (seed.items.length > 0) {
      const { error: itemsError } = await supabaseAdmin
        .from('checklist_line_items')
        .insert(seed.items.map((task, idx) => ({ checklist_id: checklist.id, task, position: idx })));
      if (itemsError) return itemsError.message;
    }
  }
  return null;
}
