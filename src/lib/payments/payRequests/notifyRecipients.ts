import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Managers holding can_manage_payments for the org: first-class pay-request
 * approvers (requireOrgPaymentsAuth admits them to approve/counter), so
 * escalation/acceptance notifications must reach them alongside the
 * owner/admin default fan-out (PR2 review finding 8).
 */
export async function paymentManagerRecipients(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('manager_permissions')
    .select('manager_id')
    .eq('organization_id', organizationId)
    .eq('can_manage_payments', true);
  return ((data ?? []) as Array<{ manager_id: string }>).map((r) => r.manager_id);
}
