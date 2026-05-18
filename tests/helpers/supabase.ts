import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _admin: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

/**
 * Admin client backed by the SERVICE_ROLE_KEY. Bypasses RLS — use only in setup/cleanup
 * and route-handler tests that simulate server-side calls.
 */
export function createTestSupabaseClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in test env.');
  }
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

/**
 * Anon-key client. Use to exercise RLS as a real user (with `setSession` after sign-in).
 */
export function createAnonClient(): SupabaseClient {
  if (_anon) return _anon;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing in test env.');
  }
  _anon = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _anon;
}
