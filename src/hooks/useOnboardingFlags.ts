import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';

/** Reads the current user's onboarding flags from user_profiles. */
export function useOnboardingFlags() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: keys.onboarding.flags(userId ?? 'none'),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('welcome_seen_at, setup_checklist_dismissed_at')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        welcomeSeen: !!data?.welcome_seen_at,
        userChecklistDismissed: !!data?.setup_checklist_dismissed_at,
      };
    },
  });

  return {
    welcomeSeen: query.data?.welcomeSeen ?? false,
    userChecklistDismissed: query.data?.userChecklistDismissed ?? false,
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
