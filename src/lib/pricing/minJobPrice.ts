/**
 * The minimum price rule: every service base price and every job price must be at
 * least $1.00.
 *
 * A $0 job is broken in every payment mode: a customer-billed charge falls below
 * Stripe's 50 cent minimum and fails, a company-pays percentage cleaner earns $0, and
 * the platform fee (a percentage of the job price) is $0. The pilot hit this with a
 * "Custom" service left at $0.
 *
 * This module is the single source for the number and the copy. The UI forms, the
 * API routes, and the database backstop (migration `require_min_price`, which raises
 * the same message with SQLSTATE 23514) all enforce the same threshold.
 */

export const MIN_JOB_PRICE_USD = 1;
export const MIN_JOB_PRICE_CENTS = 100;

/** User-facing copy. Keep in sync with the RAISE message in the require_min_price migration. */
export const MIN_JOB_PRICE_MESSAGE = 'Price must be at least $1.';

/**
 * Null when `usd` is a valid job or service price, else the user-facing message.
 * Compares in whole cents so float noise from adding a base price and a checklist
 * adder (0.99 + 0.01) cannot misjudge a price sitting exactly on the minimum.
 * Numeric strings (PostgREST can serialize numeric columns as strings) are accepted.
 */
export function jobPriceError(usd: number | string | null | undefined): string | null {
  if (usd === null || usd === undefined || usd === '') return MIN_JOB_PRICE_MESSAGE;
  const n = typeof usd === 'number' ? usd : Number(usd);
  if (!Number.isFinite(n)) return MIN_JOB_PRICE_MESSAGE;
  return Math.round(n * 100) >= MIN_JOB_PRICE_CENTS ? null : MIN_JOB_PRICE_MESSAGE;
}

/** True when `usd` meets the minimum price. */
export function meetsMinJobPrice(usd: number | string | null | undefined): boolean {
  return jobPriceError(usd) === null;
}
