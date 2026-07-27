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

/**
 * True when a Stripe error is the CONCURRENT idempotency conflict ("a request with the same
 * idempotency key is currently in flight", code `idempotency_key_in_use`). Stripe does NOT cache
 * these — the in-flight winner's result becomes the key's cached response — so the caller must
 * NOT rotate on this error: bumping would let an immediate rotated retry race the still-running
 * winner into a second transfer. (The OTHER idempotency failure, a same-key params-mismatch
 * `idempotency_error`, IS pinned to the spent key, and rotation is exactly the cure.)
 */
export function isIdempotencyConflictInFlight(err: unknown): boolean {
  const e = err as { code?: string; raw?: { code?: string } } | null;
  return e?.code === 'idempotency_key_in_use' || e?.raw?.code === 'idempotency_key_in_use';
}
