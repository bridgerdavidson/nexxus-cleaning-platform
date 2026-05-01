import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cleanerId = searchParams.get('id');

    if (!cleanerId) {
      return NextResponse.json(
        { success: false, error: 'Cleaner ID is required' },
        { status: 400 }
      );
    }

    // Check if cleaner has active appointments
    const { data: activeAppointments, error: appointmentsError } = await supabaseAdmin
      .from('appointments')
      .select('id, status')
      .eq('cleaner_id', cleanerId)
      .in('status', ['pending', 'confirmed', 'in_progress']);

    if (appointmentsError) {
      console.error('Error checking appointments:', appointmentsError);
      return NextResponse.json(
        { success: false, error: 'Failed to check cleaner appointments' },
        { status: 500 }
      );
    }

    if (activeAppointments && activeAppointments.length > 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Cannot delete cleaner with ${activeAppointments.length} active appointment(s). Please cancel or complete appointments first.` 
        },
        { status: 400 }
      );
    }

    // Look up the cleaner's email so we can clean up matching invite records.
    // The FK on invites.invited_by cascades automatically for invites *sent
    // by* this user; this lookup powers cleanup of invites *sent to* them.
    const { data: cleanerProfile, error: cleanerProfileLookupError } = await supabaseAdmin
      .from('user_profiles')
      .select('email')
      .eq('id', cleanerId)
      .single();

    if (cleanerProfileLookupError) {
      console.error('Error looking up cleaner profile email:', cleanerProfileLookupError);
    }
    const cleanerEmail = cleanerProfile?.email ? cleanerProfile.email.toLowerCase() : null;

    // Step 1: Delete from cleaner_profiles
    const { error: cleanerProfileError } = await supabaseAdmin
      .from('cleaner_profiles')
      .delete()
      .eq('id', cleanerId);

    if (cleanerProfileError) {
      console.error('Error deleting cleaner profile:', cleanerProfileError);
      // Continue even if this fails (might not exist or already deleted)
    }

    // Step 2: Delete any invites addressed to this cleaner across all orgs.
    // delete-cleaner has no organization scope (cleaner is being globally
    // removed), so all invites with a matching email are stale.
    if (cleanerEmail) {
      const { error: invitesError } = await supabaseAdmin
        .from('invites')
        .delete()
        .eq('email', cleanerEmail);

      if (invitesError) {
        console.error('Error deleting invites for cleaner:', invitesError);
        // Continue - invite cleanup is best-effort and should not block deletion.
      }
    }

    // Step 3: Delete from user_profiles (this will cascade delete cleaner_profiles if it still exists)
    const { error: userProfileError } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('id', cleanerId);

    if (userProfileError) {
      console.error('Error deleting user profile:', userProfileError);
      return NextResponse.json(
        { success: false, error: `Failed to delete user profile: ${userProfileError.message}` },
        { status: 500 }
      );
    }

    // Step 4: Delete auth user
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(cleanerId);

    if (authError) {
      console.error('Error deleting auth user:', authError);
      // Note: Profile is already deleted, so we'll log but not fail
      // The auth user might not exist or might have been deleted already
      return NextResponse.json({
        success: true,
        warning: `Cleaner profile deleted, but auth user deletion had issues: ${authError.message}`,
        message: 'Cleaner removed successfully (with warnings)'
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Cleaner deleted successfully'
    });

  } catch (error) {
    console.error('Delete cleaner error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

