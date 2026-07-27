import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

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

    // ── Auth: caller must be an owner/admin of the cleaner's org ─────────────
    // Derive the org from the cleaner's own profile (no client-supplied org to
    // spoof), then authorize the caller against THAT org. This route previously
    // had NO caller auth — anyone who could reach it could delete any cleaner.
    const { data: cleanerOrgRow, error: cleanerOrgError } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('organization_id')
      .eq('id', cleanerId)
      .maybeSingle();

    if (cleanerOrgError) {
      return NextResponse.json(
        { success: false, error: 'Failed to look up cleaner' },
        { status: 500 }
      );
    }
    if (!cleanerOrgRow) {
      return NextResponse.json(
        { success: false, error: 'Cleaner not found or already removed' },
        { status: 404 }
      );
    }

    const cleanerOrganizationId = (cleanerOrgRow as { organization_id: string }).organization_id;
    const auth = await requireOrgAuth(
      request,
      cleanerOrganizationId,
      supabaseAdmin,
      // Managers are admitted past the gate; the can_manage_cleaners check
      // below decides whether they may actually delete. Matches the
      // invites/send-invite pattern so manager cleaner-management workflows
      // (used by CleanerManagementPage when can_manage_cleaners is granted)
      // keep working.
      { allowedRoles: ['owner', 'admin', 'manager'] },
    );
    if (!auth.ok) return auth.response;

    if (auth.role === 'manager') {
      const { data: managerPerms, error: permsError } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_manage_cleaners')
        .eq('manager_id', auth.userId)
        .eq('organization_id', cleanerOrganizationId)
        .maybeSingle();

      if (permsError) {
        return NextResponse.json(
          { success: false, error: 'Failed to check manager permissions' },
          { status: 500 }
        );
      }
      if (managerPerms?.can_manage_cleaners !== true) {
        return NextResponse.json(
          { success: false, error: 'Manager does not have permission to manage cleaners' },
          { status: 403 }
        );
      }
    }

    // Don't let a caller delete their own account through this endpoint.
    if (auth.userId === cleanerId) {
      return NextResponse.json(
        { success: false, error: 'You cannot delete yourself through this endpoint' },
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

    // A pay-request thread whose money hasn't SETTLED blocks deletion (review
    // finding 2): deleting the cleaner cascades pay_requests AND payouts away,
    // so an unapproved thread would orphan the negotiation, and an
    // approved-but-unsettled one (trigger died, sweep pending, or a HELD slice
    // waiting on Connect onboarding) would erase the carved money's basis -
    // held funds become untracked platform balance. Terminal payout states
    // (paid / bank_paid / reversed) mean the machinery is done with it.
    const { data: threads } = await supabaseAdmin
      .from('pay_requests')
      .select('id, appointment_id, status')
      .eq('cleaner_id', cleanerId);
    const threadRows = (threads ?? []) as Array<{ id: string; appointment_id: string; status: string }>;
    if (threadRows.some((t) => t.status !== 'approved')) {
      return NextResponse.json(
        { success: false, error: 'Cannot delete a cleaner with an open pay request. Resolve it first.' },
        { status: 400 },
      );
    }
    if (threadRows.length > 0) {
      const { data: settledPayouts } = await supabaseAdmin
        .from('payouts')
        .select('appointment_id')
        .in('appointment_id', threadRows.map((t) => t.appointment_id))
        .in('status', ['paid', 'bank_paid', 'reversed']);
      const settledSet = new Set(
        ((settledPayouts ?? []) as Array<{ appointment_id: string }>).map((p) => p.appointment_id),
      );
      if (threadRows.some((t) => !settledSet.has(t.appointment_id))) {
        return NextResponse.json(
          { success: false, error: 'Cannot delete a cleaner with an unsettled pay request. Wait for the payout to finish first.' },
          { status: 400 },
        );
      }
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

