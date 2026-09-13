import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { parsePropertyCreate } from '@/lib/properties/parsePropertyInput';

export const runtime = 'nodejs';

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/properties
 *
 * Adds a home. A homeowner adds their own (owner forced to the caller). An
 * owner, admin, or manager with can_edit_properties adds one for a homeowner
 * member of the org (owner_id required and checked). These are the two shapes
 * migration 104's properties_insert policy allows for those roles; the route
 * mirrors them because it writes with the service role.
 *
 * Body: { organization_id, owner_id?, name, address, city, state, zip_code,
 *         bedrooms?, bathrooms?, square_feet?, special_instructions?, access_instructions? }
 * Returns 201 { success: true, data: Property }.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = parsePropertyCreate(await request.json().catch(() => null));
    if (!parsed.ok) return fail(400, parsed.error);
    const input = parsed.value;

    const auth = await requireManagerPermission(request, input.organization_id, supabaseAdmin, 'can_edit_properties', {
      allowedRoles: ['homeowner', 'owner', 'admin', 'manager'],
      errorMessage: 'Requires the Edit properties permission',
      requireWritable: true,
    });
    if (!auth.ok) return auth.response;

    let ownerId: string;
    if (auth.role === 'homeowner') {
      ownerId = auth.userId;
    } else {
      if (!input.owner_id) return fail(400, 'owner_id is required');
      const { data: member, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', input.owner_id)
        .eq('organization_id', input.organization_id)
        .eq('role', 'homeowner')
        .maybeSingle();
      if (memberError) return fail(500, memberError.message);
      if (!member) {
        return fail(400, 'owner_id must be a homeowner in this organization');
      }
      ownerId = input.owner_id;
    }

    const { data, error } = await supabaseAdmin
      .from('properties')
      .insert({
        organization_id: input.organization_id,
        owner_id: ownerId,
        name: input.name,
        address: input.address,
        city: input.city,
        state: input.state,
        zip_code: input.zip_code,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        square_feet: input.square_feet,
        special_instructions: input.special_instructions,
        access_instructions: input.access_instructions,
      })
      .select('*')
      .single();
    if (error || !data) {
      return fail(500, error?.message ?? 'Could not save the property.');
    }
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : 'Internal server error');
  }
}
