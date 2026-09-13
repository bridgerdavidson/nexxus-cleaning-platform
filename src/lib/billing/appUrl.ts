/**
 * The trusted absolute base URL for links we hand to Stripe.
 *
 * Never build these from the request Host header: it is attacker-controlled, and
 * a Checkout success_url is a redirect target. Throwing loudly when the variable
 * is missing is deliberate, because every silent fallback in this codebase today
 * produces either the literal string "undefined/..." or a dead hostname.
 */
export function requireAppUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) {
    throw new Error('APP_URL is not set. Stripe return URLs must be absolute.');
  }
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`APP_URL must be an absolute http(s) URL, got "${raw}".`);
  }
  return raw.replace(/\/+$/, '');
}
