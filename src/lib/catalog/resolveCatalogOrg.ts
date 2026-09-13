import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side lookups that answer "which org owns this catalog row". Routes
 * authorize against the org they return, never against an org id from the body.
 * Extended in PR B with checklist and line-item resolvers.
 */
export async function resolveServiceOrg(
  db: SupabaseClient,
  serviceId: string,
): Promise<{ organizationId: string } | null> {
  const { data } = await db
    .from('service_types')
    .select('organization_id')
    .eq('id', serviceId)
    .maybeSingle();
  return data?.organization_id ? { organizationId: data.organization_id as string } : null;
}
