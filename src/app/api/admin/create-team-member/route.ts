import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, email, phone, role, organizationId } = body;

    // Validate inputs
    if (!firstName || !lastName || !email || !role || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!['cleaner', 'manager'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role. Must be "cleaner" or "manager"' },
        { status: 400 }
      );
    }

    // Generate a temporary password (user will need to reset it)
    const tempPassword = `Temp${Math.random().toString(36).slice(-12)}!`;

    // Step 1: Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
      },
      app_metadata: {
        role: role,
      },
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return NextResponse.json(
        { success: false, error: `Failed to create auth user: ${authError.message}` },
        { status: 500 }
      );
    }

    if (!authData.user) {
      return NextResponse.json(
        { success: false, error: 'Failed to create auth user' },
        { status: 500 }
      );
    }

    const userId = authData.user.id;

    // Step 2: Wait a moment for the trigger to create the profile
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Update user profile with phone if provided
    if (phone) {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          phone,
          first_name: firstName,
          last_name: lastName,
        })
        .eq('id', userId);

      if (profileError) {
        console.error('Error updating user profile:', profileError);
        // Continue - profile might have been created by trigger
      }
    }

    // Step 4: Add to organization_members
    const { error: orgMemberError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: organizationId,
        user_id: userId,
        role: role,
      });

    if (orgMemberError) {
      console.error('Error adding to organization:', orgMemberError);
      // Try to clean up auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { success: false, error: `Failed to add to organization: ${orgMemberError.message}` },
        { status: 500 }
      );
    }

    // Step 5: If cleaner, create cleaner_profile
    if (role === 'cleaner') {
      const { error: cleanerProfileError } = await supabaseAdmin
        .from('cleaner_profiles')
        .insert({
          id: userId,
          organization_id: organizationId,
        });

      if (cleanerProfileError) {
        console.error('Error creating cleaner profile:', cleanerProfileError);
        // Continue - this might be okay if it already exists
      }
    }

    // Step 6: If manager, create manager_permissions with default (all false)
    if (role === 'manager') {
      const { error: permissionsError } = await supabaseAdmin
        .from('manager_permissions')
        .insert({
          manager_id: userId,
          organization_id: organizationId,
          can_view_customers: false,
          can_edit_customers: false,
          can_view_bookings: false,
          can_edit_bookings: false,
          can_manage_cleaners: false,
          can_view_properties: false,
          can_edit_properties: false,
          can_view_analytics: false,
          can_view_payments: false,
          can_manage_payments: false,
          can_view_messages: false,
        });

      if (permissionsError) {
        console.error('Error creating manager permissions:', permissionsError);
        // Continue - permissions can be set later
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        userId,
        email,
        role,
      },
      message: `${role === 'cleaner' ? 'Cleaner' : 'Manager'} created successfully`,
    });

  } catch (error) {
    console.error('Create team member error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

