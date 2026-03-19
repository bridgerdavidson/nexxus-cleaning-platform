import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, organizationId } = body;

    if (!userId || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'User ID and Organization ID are required' },
        { status: 400 }
      );
    }

    // Get the user's role in the organization
    const { data: orgMember, error: orgMemberError } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .single();

    if (orgMemberError || !orgMember) {
      return NextResponse.json(
        { success: false, error: 'Team member not found in organization' },
        { status: 404 }
      );
    }

    const role = orgMember.role;

    // If cleaner, check for active appointments
    if (role === 'cleaner') {
      const { data: activeAppointments, error: appointmentsError } = await supabaseAdmin
        .from('appointments')
        .select('id, status')
        .eq('cleaner_id', userId)
        .in('status', ['pending', 'confirmed', 'in_progress']);

      if (appointmentsError) {
        console.error('Error checking appointments:', appointmentsError);
        return NextResponse.json(
          { success: false, error: 'Failed to check appointments' },
          { status: 500 }
        );
      }

      if (activeAppointments && activeAppointments.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot delete cleaner with ${activeAppointments.length} active appointment(s). Please cancel or complete appointments first.`,
          },
          { status: 400 }
        );
      }
    }

    // Step 1: Remove from organization_members (soft delete - removes access)
    const { error: removeError } = await supabaseAdmin
      .from('organization_members')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', organizationId);

    if (removeError) {
      console.error('Error removing from organization:', removeError);
      return NextResponse.json(
        { success: false, error: `Failed to remove from organization: ${removeError.message}` },
        { status: 500 }
      );
    }

    // Step 2: If cleaner, delete cleaner_profile
    if (role === 'cleaner') {
      const { error: cleanerProfileError } = await supabaseAdmin
        .from('cleaner_profiles')
        .delete()
        .eq('id', userId);

      if (cleanerProfileError) {
        console.error('Error deleting cleaner profile:', cleanerProfileError);
        // Continue - might not exist
      }
    }

    // Step 3: If manager, delete manager_permissions
    if (role === 'manager') {
      const { error: permissionsError } = await supabaseAdmin
        .from('manager_permissions')
        .delete()
        .eq('manager_id', userId)
        .eq('organization_id', organizationId);

      if (permissionsError) {
        console.error('Error deleting manager permissions:', permissionsError);
        // Continue - might not exist
      }
    }

    // Step 4: Delete user_profile (cascades to any remaining cleaner_profiles)
    const { error: userProfileError } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('id', userId);

    if (userProfileError) {
      console.error('Error deleting user profile:', userProfileError);
      return NextResponse.json(
        { success: false, error: `Failed to delete user profile: ${userProfileError.message}` },
        { status: 500 }
      );
    }

    // Step 5: Delete auth user
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('Error deleting auth user:', authError);
      return NextResponse.json({
        success: true,
        warning: `User profile deleted, but auth user deletion had issues: ${authError.message}`,
        message: 'Team member deleted (with warnings)',
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Team member deleted successfully',
    });

  } catch (error) {
    console.error('Delete team member error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

