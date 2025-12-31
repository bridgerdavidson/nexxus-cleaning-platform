import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      managerId,
      organizationId,
      can_view_customers,
      can_edit_customers,
      can_view_bookings,
      can_edit_bookings,
      can_approve_decline_bookings,
      can_manage_cleaners,
      can_view_properties,
      can_edit_properties,
      can_view_analytics,
      can_view_payments,
      can_manage_payments,
      can_view_messages,
    } = body;

    // Validate inputs
    if (!managerId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Manager ID and Organization ID are required' },
        { status: 400 }
      );
    }

    // Verify manager belongs to organization
    const { data: orgMember, error: orgMemberError } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', managerId)
      .eq('organization_id', organizationId)
      .eq('role', 'manager')
      .single();

    if (orgMemberError || !orgMember) {
      return NextResponse.json(
        { success: false, error: 'Manager not found in organization' },
        { status: 404 }
      );
    }

    // Upsert permissions
    const { error: permissionsError } = await supabaseAdmin
      .from('manager_permissions')
      .upsert(
        {
          manager_id: managerId,
          organization_id: organizationId,
          can_view_customers: can_view_customers || false,
          can_edit_customers: can_edit_customers || false,
          can_view_bookings: can_view_bookings || false,
          can_edit_bookings: can_edit_bookings || false,
          can_approve_decline_bookings: can_approve_decline_bookings || false,
          can_manage_cleaners: can_manage_cleaners || false,
          can_view_properties: can_view_properties || false,
          can_edit_properties: can_edit_properties || false,
          can_view_analytics: can_view_analytics || false,
          can_view_payments: can_view_payments || false,
          can_manage_payments: can_manage_payments || false,
          can_view_messages: can_view_messages || false,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'manager_id,organization_id',
        }
      );

    if (permissionsError) {
      console.error('Error updating manager permissions:', permissionsError);
      return NextResponse.json(
        { success: false, error: `Failed to update permissions: ${permissionsError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Manager permissions updated successfully',
    });

  } catch (error) {
    console.error('Update manager permissions error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

