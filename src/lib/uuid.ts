/**
 * Returns an RFC4122 v4 UUID string.
 *
 * Prefers `crypto.randomUUID()` when available (secure contexts: HTTPS or
 * localhost). On non-secure HTTP contexts (e.g. accessing a dev server via
 * LAN IP from a phone), `crypto.randomUUID` is undefined; we fall back to
 * `crypto.getRandomValues` which works in any context, and finally to
 * `Math.random` as a last resort.
 */
export function uuidv4(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' && 'crypto' in globalThis
      ? (globalThis.crypto as Crypto)
      : undefined;

  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Per RFC4122 §4.4 — set version (4) and variant (10xx) bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));

  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
