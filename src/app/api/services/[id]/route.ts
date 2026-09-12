import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeService } from '@/lib/catalog/authorizeCatalog';
import { parseServiceUpdate } from '@/lib/catalog/serviceInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/services/:id
 * Partial update of a service. Body: any of { name, description, base_price,
 * duration_minutes, service_type, is_active }. Returns { success: true, data: ServiceType }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeService(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseServiceUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('service_types')
      .update(parsed.value)
      .eq('id', id)
      .eq('organization_id', auth.organizationId)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to update service' }, { status: 500 });
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
 * DELETE /api/services/:id
 * Refuses (409) while any appointment or recurring series references the
 * service, with the same wording the client used to show. Otherwise deletes it
 * (checklists and items cascade). Returns { success: true }.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeService(request, id);
    if (!auth.ok) return auth.response;

    const [appts, series] = await Promise.all([
      supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('service_type_id', id),
      supabaseAdmin
        .from('recurring_appointment_series')
        .select('id', { count: 'exact', head: true })
        .eq('service_type_id', id),
    ]);
    if (appts.error || series.error) {
      return NextResponse.json(
        { error: appts.error?.message ?? series.error?.message ?? 'Failed to check service usage' },
        { status: 500 },
      );
    }
    if ((appts.count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete service that is used in existing appointments. Consider disabling it instead.' },
        { status: 409 },
      );
    }
    if ((series.count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete service that is used in recurring appointment series. Consider disabling it instead.' },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin
      .from('service_types')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.organizationId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
