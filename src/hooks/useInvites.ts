'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { inviteTeamMember } from './useAdminData';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import type { Invite } from '../types';

interface UseInvitesOptions {
  enabled?: boolean;
}

interface UseInvitesResult {
  invites: Invite[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  resend: (invite: Invite) => Promise<{ success: boolean; error?: string }>;
}

export function useInvites(
  organizationId: string | null | undefined,
  accessToken: string | null | undefined,
  options: UseInvitesOptions = {}
): UseInvitesResult {
  const enabled = options.enabled !== false;
  const queryKey = keys.invites.byOrg(organizationId ?? '');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    enabled: enabled && !!organizationId && !!accessToken,
    queryFn: async () => {
      const res = await fetch(`/api/invites?organizationId=${encodeURIComponent(organizationId as string)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load invites');
      }
      return data.invites as Invite[];
    },
  });

  useSupabaseRealtimeSync({
    channelName: `invites:${organizationId ?? ''}`,
    table: 'invites',
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    enabled: enabled && !!organizationId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const resend = useCallback(
    async (invite: Invite) => {
      if (!enabled || !organizationId || !accessToken) {
        return { success: false, error: 'Missing organization or session' };
      }
      const result = await inviteTeamMember({
        email: invite.email,
        role: invite.role,
        organizationId,
        accessToken,
      });
      if (result.success) {
        // Realtime will refresh too, but kick one off immediately for snappy UX.
        await queryClient.invalidateQueries({ queryKey });
      }
      return result;
    },
    [enabled, organizationId, accessToken, queryClient, queryKey]
  );

  return {
    invites: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch,
    resend,
  };
}
