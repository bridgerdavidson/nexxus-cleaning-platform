'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads the org kill-switch `homeowner_cleaner_messaging_enabled`. Defaults to
 * TRUE on any error or while loading (the guarded send route is the real gate;
 * this only hides entry points when the org has opted out). RLS: homeowner is an
 * org member and can read their org row.
 */
export function useHomeownerOrgMessagingEnabled(): boolean {
  const { currentOrganizationId } = useAuth();
  const { data } = useQuery({
    queryKey: ['org-messaging-enabled', currentOrganizationId ?? 'none'],
    enabled: !!currentOrganizationId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('homeowner_cleaner_messaging_enabled')
        .eq('id', currentOrganizationId as string)
        .maybeSingle();
      if (error) throw error;
      return data?.homeowner_cleaner_messaging_enabled ?? true;
    },
  });
  return data ?? true;
}
