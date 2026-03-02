/**
 * Phone formatting and normalization for US (xxx)xxx-xxxx display.
 * Store digits only in the database (e.g. "5551234567") for consistency, search, and APIs.
 */

/** Extract digits only from a string (e.g. "(555) 123-4567" or "5551234567"). Max 10 for US. */
export function normalizePhoneToDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

/**
 * Format up to 10 digits as (xxx)xxx-xxxx.
 * Partial input is formatted as you go, e.g. "555" -> "(555)", "5551234" -> "(555)123-4".
 */
export function formatPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 3)})${d.slice(3)}`;
  return `(${d.slice(0, 3)})${d.slice(3, 6)}-${d.slice(6)}`;
}
