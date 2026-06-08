/**
 * Split an array into consecutive chunks of at most `size` items.
 *
 * Used to bound how many rows a single bulk DB statement touches. A large
 * multi-select (e.g. deleting 60+ appointments) becomes a few small,
 * sequential `.in(...)` statements instead of one oversized transaction or a
 * storm of concurrent single-row requests that can exhaust the connection pool.
 *
 * The input is not mutated and element order is preserved.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
