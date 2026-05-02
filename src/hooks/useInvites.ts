'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { inviteTeamMember } from './useAdminData';
import type { Invite } from '../types';

interface UseInvitesResult {
  invites: Invite[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  resend: (invite: Invite) => Promise<{ success: boolean; error?: string }>;
}

export function useInvites(
  organizationId: string | null | undefined,
  accessToken: string | null | undefined
): UseInvitesResult {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(accessToken);

  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const fetchInvites = useCallback(async () => {
    if (!organizationId || !tokenRef.current) {
      setInvites([]);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const res = await fetch(`/api/invites?organizationId=${encodeURIComponent(organizationId)}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load invites');
      }

      setInvites(data.invites as Invite[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invites');
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setLoading(true);
    fetchInvites();
  }, [fetchInvites]);

  // Realtime subscription — refetch on any change to invites for this org.
  useEffect(() => {
    if (!organizationId) return;

    const channel = supabase
      .channel(`invites:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invites',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          fetchInvites();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchInvites]);

  const resend = useCallback(
    async (invite: Invite) => {
      if (!organizationId || !tokenRef.current) {
        return { success: false, error: 'Missing organization or session' };
      }

      const result = await inviteTeamMember({
        email: invite.email,
        role: invite.role,
        organizationId,
        accessToken: tokenRef.current,
      });

      if (result.success) {
        // Realtime will trigger refetch, but kick one off immediately for snappy UX.
        await fetchInvites();
      }

      return result;
    },
    [organizationId, fetchInvites]
  );

  return { invites, loading, error, refetch: fetchInvites, resend };
}
