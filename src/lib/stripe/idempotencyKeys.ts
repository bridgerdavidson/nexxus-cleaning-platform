/**
 * Attempt-suffixed transfer idempotency key (T1-11). Stripe saves the first result for a key —
 * success OR a business error like balance_insufficient — for at least 24h, so retrying a FAILED
 * create under the same key replays the cached failure until the key ages out, locking the payout
 * for a day. After a recorded create-failure the caller bumps its persisted attempt counter
 * (payouts.transfer_attempt / payments.tenant_transfer_attempt, migration 114) so the next try
 * gets a fresh key. Attempt 0 keeps the historical unsuffixed key so keys already spent by
 * in-flight settlements stay valid. A rotated key is no longer a lost-response double-pay guard
 * by itself, so every rotated create must be preceded by an adopt-existing scan of the
 * transfer_group.
 *
 * Lives in its own Stripe-free module (not transfers.ts) so integration tests that mock
 * `@/lib/stripe/transfers` wholesale keep the real key logic.
 */
export function transferIdempotencyKey(base: string, attempt: number): string {
  return attempt > 0 ? `${base}-${attempt}` : base;
}
