import { supabase } from '@/lib/supabase';

/** Per-user flags are RLS-safe to update directly (user_profiles_update policy allows self). */
export async function markWelcomeSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ welcome_seen_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function dismissUserChecklist(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ setup_checklist_dismissed_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

/** Stamps branding_visited_at (first visit only, server-side no-op after).
 * Same authed route as dismissal, for the same creator-only RLS reason. */
export async function markBrandingVisited(orgId: string, accessToken: string): Promise<void> {
  const res = await fetch(`/api/organizations/${orgId}/onboarding`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mark_branding_visited: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Failed to mark branding visited');
  }
}

/** Org-level dismissal goes through an authed route: the org UPDATE policy is
 * creator-only, so a non-creator admin cannot update the row client-side. */
export async function dismissOrgChecklist(orgId: string, accessToken: string): Promise<void> {
  const res = await fetch(`/api/organizations/${orgId}/onboarding`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ dismiss_setup_checklist: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Failed to dismiss checklist');
  }
}
