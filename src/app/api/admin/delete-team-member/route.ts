import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

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

    // ── Auth: caller must be an admin/owner of this org ─────────────────────
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    // Don't let an admin delete themselves through this endpoint — there are other paths
    // (account deletion, leave org) for that and the team-member UI shouldn't accidentally
    // wipe the caller out.
    if (auth.userId === userId) {
      return NextResponse.json(
        { success: false, error: 'You cannot delete yourself through this endpoint' },
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

    // Never delete the organization owner through this endpoint. An admin caller
    // passes the owner/admin role gate, but removing the owner would leave the org
    // with no owner and hand control to the remaining admins. Ownership changes go
    // through a dedicated transfer flow, not team-member deletion.
    if (role === 'owner') {
      return NextResponse.json(
        {
          success: false,
          error: 'The organization owner cannot be removed here. Transfer ownership first.',
        },
        { status: 403 }
      );
    }

    // Look up the user's email so we can clean up matching invites later.
    // user_profiles stores email lower-cased on insert via the auth trigger;
    // invites.email has a CHECK (email = lower(email)) constraint, so we
    // lower-case defensively before matching.
    const { data: userProfile, error: userProfileLookupError } = await supabaseAdmin
      .from('user_profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (userProfileLookupError) {
      console.error('Error looking up user profile email:', userProfileLookupError);
    }
    const userEmail = userProfile?.email ? (userProfile.email as string).toLowerCase() : null;

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
      }
    }

    // Step 4: Delete any invites addressed to this user for this organization.
    if (userEmail) {
      const { error: invitesError } = await supabaseAdmin
        .from('invites')
        .delete()
        .eq('organization_id', organizationId)
        .eq('email', userEmail);

      if (invitesError) {
        console.error('Error deleting invites for user:', invitesError);
      }
    }

    // Step 5: Delete user_profile
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

    // Step 6: Delete auth user
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
