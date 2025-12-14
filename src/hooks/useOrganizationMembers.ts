import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface OrganizationMember {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string;
  avatar_url: string | null;
  org_role: string; // Role in the organization (owner, admin, manager, cleaner, homeowner)
}

interface UseOrganizationMembersOptions {
  excludeCurrentUser?: boolean;
}

export function useOrganizationMembers(options: UseOrganizationMembersOptions = {}) {
  const { excludeCurrentUser = true } = options;
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchMembers = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      console.log('[useOrganizationMembers] Fetching members for org:', currentOrganizationId);

      // Fetch all organization members with their user profiles
      const { data: orgMembers, error: membersError } = await supabase
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', currentOrganizationId);

      if (membersError) {
        console.error('[useOrganizationMembers] Error fetching org members:', membersError);
        throw membersError;
      }

      console.log('[useOrganizationMembers] Found org members:', orgMembers?.length || 0, orgMembers);

      if (!orgMembers || orgMembers.length === 0) {
        console.log('[useOrganizationMembers] No organization members found');
        setMembers([]);
        setLoading(false);
        return;
      }

      // Get all user IDs
      let userIds = orgMembers.map(m => m.user_id);
      
      // Filter out current user if requested
      if (excludeCurrentUser) {
        userIds = userIds.filter(id => id !== user.id);
      }

      console.log('[useOrganizationMembers] User IDs to fetch:', userIds.length, userIds);

      if (userIds.length === 0) {
        console.log('[useOrganizationMembers] No user IDs after filtering');
        setMembers([]);
        setLoading(false);
        return;
      }

      // Fetch user profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, email, first_name, last_name, phone, role, avatar_url')
        .in('id', userIds);

      if (profilesError) {
        console.error('[useOrganizationMembers] Error fetching user profiles:', profilesError);
        throw profilesError;
      }

      console.log('[useOrganizationMembers] Fetched profiles:', profiles?.length || 0, profiles);

      // Map org roles to user profiles
      const orgRoleMap = new Map(orgMembers.map(m => [m.user_id, m.role]));

      // Combine data
      const combinedMembers: OrganizationMember[] = (profiles || []).map(profile => ({
        id: profile.id,
        email: profile.email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone,
        role: profile.role,
        avatar_url: profile.avatar_url,
        org_role: orgRoleMap.get(profile.id) || 'member'
      }));

      // Sort by name
      combinedMembers.sort((a, b) => {
        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setMembers(combinedMembers);
    } catch (err) {
      console.error('Error fetching organization members:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch organization members');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId, excludeCurrentUser]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return {
    members,
    loading,
    error,
    refetch: fetchMembers
  };
}

