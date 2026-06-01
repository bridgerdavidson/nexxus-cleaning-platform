import type { SupabaseClient } from '@supabase/supabase-js';

export interface VerifiedToken {
  userId: string;
  email: string | null;
}

/**
 * Verify a Supabase access token and return the caller's id + email, or null if
 * the token is missing/invalid/expired.
 *
 * Prefers `auth.getClaims()`. When the project uses ASYMMETRIC JWT signing keys
 * (ES256/RS256), getClaims verifies the token locally against a cached JWKS with
 * NO network round trip to GoTrue `/user`. On the legacy HS256 symmetric secret,
 * getClaims transparently falls back to a `getUser()` network call — so this is a
 * no-regression change that starts eliminating the slow prod `/user` latency the
 * moment the project migrates to asymmetric keys (Supabase Dashboard → Auth →
 * JWT Keys → rotate to ES256/RS256).
 *
 * If getClaims is unavailable or throws (e.g. a unit-test mock that only stubs
 * getUser, or a transient JWKS-fetch error), we fall back to getUser so the
 * result is always correct.
 */
export async function verifyAccessToken(
  supabaseAdmin: SupabaseClient,
  token: string,
): Promise<VerifiedToken | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.getClaims(token);
    if (error) return null;
    const claims = data?.claims as { sub?: string; email?: string } | undefined;
    if (claims?.sub) {
      return { userId: claims.sub, email: claims.email ?? null };
    }
    // Verified-but-no-subject is not expected for a real token; fall through to
    // getUser as a safety net rather than guessing.
  } catch {
    // getClaims missing/threw — fall back to the network getUser path below.
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null };
}
