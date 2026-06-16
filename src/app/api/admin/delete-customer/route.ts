import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * Hard-delete one or more customers (homeowners) from an organization.
 *
 * Unlike the old client-side "delete" (which only removed the
 * organization_members row and left a zombie auth user + invite behind), this
 * route fully removes a clean customer: org membership, any pending invite, the
 * user_profiles row, and the auth user (which cascades the rest).
 *
 * A customer that has booking or invoice history is BLOCKED, not deleted, so we
 * never destroy financial records (and because the payments -> application_fees
 * / disputes NO-ACTION FKs would reject the cascade anyway).
 *
 * Bulk-safe: customerIds are processed SEQUENTIALLY (never fanned out) because a
 * prior bulk-delete that fired many concurrent deletes saturated the connection
 * pool and 504'd. Always returns 200 with a per-id result array (auth/parse
 * failures are the only non-200s) so the UI can report partial success.
 */
interface DeleteResult {
  id: string;
  status: 'deleted' | 'blocked' | 'error';
  reason?: string;
}

export async function DELETE(request: NextRequest) {
  let body: { organizationId?: string; customerIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { organizationId, customerIds } = body;
  if (!organizationId || !Array.isArray(customerIds) || customerIds.length === 0) {
    return NextResponse.json(
      { success: false, error: 'organizationId and a non-empty customerIds array are required' },
      { status: 400 },
    );
  }

  // Auth: owners/admins, or managers holding can_edit_customers (mirrors the
  // invite permission model in /api/admin/send-invite).
  const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
    allowedRoles: ['owner', 'admin', 'manager'],
  });
  if (!auth.ok) return auth.response;

  if (auth.role === 'manager') {
    const { data: perms, error: permsError } = await supabaseAdmin
      .from('manager_permissions')
      .select('can_edit_customers')
      .eq('manager_id', auth.userId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (permsError) {
      return NextResponse.json(
        { success: false, error: 'Failed to check manager permissions' },
        { status: 500 },
      );
    }
    if (perms?.can_edit_customers !== true) {
      return NextResponse.json(
        { success: false, error: 'Manager does not have permission to manage customers' },
        { status: 403 },
      );
    }
  }

  const results: DeleteResult[] = [];

  for (const id of customerIds) {
    try {
      if (id === auth.userId) {
        results.push({ id, status: 'error', reason: 'You cannot delete yourself.' });
        continue;
      }

      // The target must be a homeowner member of THIS org. This (plus the auth
      // gate above) is the only access control, since supabaseAdmin bypasses RLS.
      const { data: member, error: memberError } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', id)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (memberError) {
        results.push({ id, status: 'error', reason: 'Failed to look up membership.' });
        continue;
      }
      if (!member || member.role !== 'homeowner') {
        results.push({ id, status: 'error', reason: 'Not a customer in this organization.' });
        continue;
      }

      // History guard: block (never destroy) customers with bookings or invoices.
      // appointments is the umbrella for payment history (payments FK the
      // appointment, not the homeowner); invoices FK homeowner_id directly.
      const [appts, invs] = await Promise.all([
        supabaseAdmin
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('homeowner_id', id),
        supabaseAdmin
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('homeowner_id', id),
      ]);
      if (appts.error || invs.error) {
        results.push({ id, status: 'error', reason: 'Failed to check customer history.' });
        continue;
      }
      const apptCount = appts.count ?? 0;
      const invCount = invs.count ?? 0;
      if (apptCount > 0 || invCount > 0) {
        const parts: string[] = [];
        if (apptCount > 0) parts.push(`${apptCount} booking${apptCount === 1 ? '' : 's'}`);
        if (invCount > 0) parts.push(`${invCount} invoice${invCount === 1 ? '' : 's'}`);
        results.push({
          id,
          status: 'blocked',
          reason: `Has ${parts.join(' and ')}. Cancel or remove these first.`,
        });
        continue;
      }

      // Email is needed to clear the matching invite (invites have no FK to the
      // invitee; they are keyed by email + org).
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('email')
        .eq('id', id)
        .maybeSingle();
      const email = profile?.email ? (profile.email as string).toLowerCase() : null;

      // Remove the org membership first.
      const { error: memberDeleteError } = await supabaseAdmin
        .from('organization_members')
        .delete()
        .eq('user_id', id)
        .eq('organization_id', organizationId);
      if (memberDeleteError) {
        results.push({ id, status: 'error', reason: 'Failed to remove from organization.' });
        continue;
      }

      // Clear any invite for this email in THIS org (scoped, like delete-team-member).
      if (email) {
        const { error: inviteError } = await supabaseAdmin
          .from('invites')
          .delete()
          .eq('organization_id', organizationId)
          .eq('email', email);
        if (inviteError) {
          console.error('delete-customer: failed to delete invites for', id, inviteError);
          // Non-fatal; continue to account cleanup.
        }
      }

      // Multi-org safety: only hard-delete the global account when this user has
      // no OTHER org membership and isn't platform staff (mirrors send-invite
      // Guard 2). The membership we just removed is already gone, so any rows
      // here belong to other orgs.
      const { data: otherMemberships, error: otherError } = await supabaseAdmin
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', id);
      if (otherError) {
        // Already removed from this org; don't risk deleting a possibly-shared
        // account when we can't verify. Done from this org's perspective.
        results.push({ id, status: 'deleted', reason: 'Removed from organization (account retained).' });
        continue;
      }
      const { data: platformAdmin } = await supabaseAdmin
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', id)
        .maybeSingle();
      if ((otherMemberships ?? []).length > 0 || platformAdmin) {
        results.push({ id, status: 'deleted' });
        continue;
      }

      // No other memberships: full hard-delete. Delete the profile first (matches
      // delete-team-member ordering), then the auth user, which cascades anything
      // else this clean customer owns (properties, conversations, etc.).
      const { error: profileDeleteError } = await supabaseAdmin
        .from('user_profiles')
        .delete()
        .eq('id', id);
      if (profileDeleteError) {
        console.error('delete-customer: failed to delete user profile for', id, profileDeleteError);
        // Fall through; the auth delete cascades to user_profiles anyway.
      }

      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (authError) {
        console.error('delete-customer: failed to delete auth user for', id, authError);
        results.push({ id, status: 'deleted', reason: 'Removed, but the login could not be fully cleared.' });
        continue;
      }

      results.push({ id, status: 'deleted' });
    } catch (err) {
      console.error('delete-customer: unexpected error for', id, err);
      results.push({ id, status: 'error', reason: 'Unexpected error.' });
    }
  }

  return NextResponse.json({ success: true, results }, { status: 200 });
}
