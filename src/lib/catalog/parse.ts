/**
 * Tiny pure parsing primitives for route bodies. Every route parser in
 * src/lib/catalog, src/lib/appointments and src/lib/properties builds on these
 * so error wording and normalization (trim, cents rounding) stay identical.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asRecord(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Non-negative dollar amount, numbers or numeric strings, rounded to cents. */
export function parseMoney(v: unknown, label: string): ParseResult<number> {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${label} must be a number of 0 or more` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function parseRequiredText(v: unknown, label: string, max: number): ParseResult<string> {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `${label} is required` };
  const text = v.trim();
  if (text.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer` };
  return { ok: true, value: text };
}

/** Absent, null, or blank become null; text is trimmed. */
export function parseOptionalText(v: unknown, label: string): ParseResult<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${label} must be text` };
  return { ok: true, value: v.trim() || null };
}
