/**
 * Classify a Supabase Auth error from a transactional-email trigger (password
 * recovery, magic link, etc.) as a genuine SMTP / provider send failure worth
 * paging the platform owner about — versus a benign client error we must NOT alert
 * on.
 *
 * Background: when the project's custom SMTP rejects GoTrue's login (e.g. the
 * provider returns "535 5.7.8 Authentication failed"), GoTrue returns HTTP 500 with
 * code `unexpected_failure` and message "Error sending recovery email". That is the
 * outage we care about. Rate-limit (429) and validation (400/422) errors are the
 * caller's problem, not a provider outage, so they return false — otherwise a user
 * fat-fingering an email or hitting the rate limit would page the owner.
 */
export interface AuthEmailErrorLike {
  status?: number;
  code?: string;
  message?: string;
  name?: string;
}

export function isAuthEmailSendFailure(
  error: AuthEmailErrorLike | null | undefined,
): boolean {
  if (!error) return false;

  // Benign client-side conditions — never page on these.
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') return false;
  if (error.status === 400 || error.status === 422) return false;

  // GoTrue surfaces a send failure as a 5xx / unexpected_failure ...
  if (typeof error.status === 'number' && error.status >= 500) return true;
  if (error.code === 'unexpected_failure') return true;

  // ... and the message is explicit even when the status is absent.
  if (error.message && /error sending .*email/i.test(error.message)) return true;

  return false;
}
