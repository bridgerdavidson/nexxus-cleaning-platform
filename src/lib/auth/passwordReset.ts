import { createClient, type AuthError } from '@supabase/supabase-js';

/**
 * Trigger a password-recovery email through Supabase Auth (GoTrue), server-side.
 *
 * We use a fresh anon-key client (no session persistence) so this behaves exactly
 * like the old browser call did: GoTrue short-circuits for unknown emails (returns
 * no error, so there's no enumeration leak) and only returns an error when a real
 * send was attempted and failed. A provider SMTP rejection surfaces here as
 * `status: 500` / `code: 'unexpected_failure'` / message "Error sending recovery
 * email". The caller inspects that error (see isAuthEmailSendFailure) to decide
 * whether to raise a platform-owner alert.
 *
 * Isolated in its own module so route integration tests can `vi.mock` it.
 */
export async function triggerPasswordReset(
  email: string,
  redirectTo?: string,
): Promise<{ error: AuthError | null }> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error } = await client.auth.resetPasswordForEmail(
    email,
    redirectTo ? { redirectTo } : undefined,
  );
  return { error };
}
