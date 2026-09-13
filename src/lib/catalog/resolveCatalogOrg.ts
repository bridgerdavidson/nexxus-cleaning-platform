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
  const { data, error } = await db
    .from('service_types')
    .select('organization_id')
    .eq('id', serviceId)
    .maybeSingle();
  if (error) throw error;
  return data?.organization_id ? { organizationId: data.organization_id as string } : null;
}

/**
 * The org and service a checklist belongs to. PostgREST returns the to-one
 * `service_types` embed as an object; the Array check guards an untyped client.
 */
export async function resolveChecklistOrg(
  db: SupabaseClient,
  checklistId: string,
): Promise<{ organizationId: string; serviceTypeId: string } | null> {
  const { data, error } = await db
    .from('checklists')
    .select('service_type_id, service_types ( organization_id )')
    .eq('id', checklistId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.service_type_id) return null;
  const rel = data.service_types as { organization_id?: string } | { organization_id?: string }[] | null;
  const organizationId = Array.isArray(rel) ? rel[0]?.organization_id : rel?.organization_id;
  return organizationId ? { organizationId, serviceTypeId: data.service_type_id as string } : null;
}

/** The org, service and checklist a line item belongs to. */
export async function resolveLineItemOrg(
  db: SupabaseClient,
  itemId: string,
): Promise<{ organizationId: string; serviceTypeId: string; checklistId: string } | null> {
  const { data, error } = await db
    .from('checklist_line_items')
    .select('checklist_id')
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.checklist_id) return null;
  const checklist = await resolveChecklistOrg(db, data.checklist_id as string);
  return checklist ? { ...checklist, checklistId: data.checklist_id as string } : null;
}
