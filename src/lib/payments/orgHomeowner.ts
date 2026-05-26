import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether a homeowner is associated with an organization — either a member of it or
 * having booked at least one appointment with it. Gates org staff from enumerating /
 * acting on homeowners (and their saved card metadata) outside their customer base.
 */
export async function homeownerBelongsToOrg(
  supabase: SupabaseClient,
  homeownerId: string,
  organizationId: string,
): Promise<boolean> {
  const { count: memberCount } = await supabase
    .from('organization_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', homeownerId)
    .eq('organization_id', organizationId);
  if ((memberCount ?? 0) > 0) return true;

  const { count: apptCount } = await supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('homeowner_id', homeownerId)
    .eq('organization_id', organizationId);
  return (apptCount ?? 0) > 0;
}
