'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { inviteTeamMember } from './useAdminData';
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

  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(accessToken);

  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const fetchInvites = useCallback(async () => {
    if (!enabled || !organizationId || !tokenRef.current) {
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
  }, [enabled, organizationId]);

  useEffect(() => {
    if (!enabled) {
      setInvites([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    fetchInvites();
  }, [enabled, fetchInvites]);

  // Realtime subscription — refetch on any change to invites for this org.
  useEffect(() => {
    if (!enabled || !organizationId) return;

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
  }, [enabled, organizationId, fetchInvites]);

  const resend = useCallback(
    async (invite: Invite) => {
      if (!enabled || !organizationId || !tokenRef.current) {
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
    [enabled, organizationId, fetchInvites]
  );

  return { invites, loading, error, refetch: fetchInvites, resend };
}
