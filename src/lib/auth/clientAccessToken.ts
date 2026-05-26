import { supabase } from '@/lib/supabase';

/**
 * Get the current Supabase access token for authenticated client→API calls.
 * Returns null when there's no session. Attach as `Authorization: Bearer <token>`.
 */
export async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
