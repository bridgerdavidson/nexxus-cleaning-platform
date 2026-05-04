import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { keys } from '../lib/queryKeys';

export interface OrganizationMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string;
  avatar_url: string | null;
  org_role: string;
}

interface UseOrganizationMembersOptions {
  excludeCurrentUser?: boolean;
}

export function useOrganizationMembers(options: UseOrganizationMembersOptions = {}) {
  const { excludeCurrentUser = true } = options;
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const orgId = currentOrganizationId ?? '';

  const query = useOrgQuery({
    queryKey: [...keys.organizationMembers.byOrg(orgId), excludeCurrentUser ? 'noself' : 'all'] as const,
    queryFn: async ({ orgId }) => {
      const { data: orgMembers, error: membersError } = await supabase
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', orgId);

      if (membersError) throw membersError;
      if (!orgMembers || orgMembers.length === 0) return [];

      let userIds = orgMembers.map(m => m.user_id);
      if (excludeCurrentUser) userIds = userIds.filter(id => id !== userId);
      if (userIds.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, email, first_name, last_name, phone, role, avatar_url')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      const orgRoleMap = new Map(orgMembers.map(m => [m.user_id, m.role]));
      const combined: OrganizationMember[] = (profiles || []).map(profile => ({
        id: profile.id,
        email: profile.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone,
        role: profile.role,
        avatar_url: profile.avatar_url,
        org_role: orgRoleMap.get(profile.id) || 'member',
      }));

      combined.sort((a, b) => {
        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });

      return combined;
    },
  });

  return {
    members: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
