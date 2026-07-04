/**
 * Check a password against the Have I Been Pwned breached-password corpus using
 * k-anonymity: only the first 5 hex chars of the SHA-1 are sent, never the
 * password. FAIL OPEN , if HIBP is unreachable or errors, treat the password as
 * not-breached (this is an enhancement on top of validatePassword, not a gate).
 */
export async function checkPasswordNotBreached(password: string): Promise<{ breached: boolean }> {
  try {
    const enc = new TextEncoder().encode(password);
    const digest = await globalThis.crypto.subtle.digest('SHA-1', enc);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return { breached: false };
    const body = await res.text();
    const breached = body.split('\n').some((line) => line.split(':')[0]?.trim().toUpperCase() === suffix);
    return { breached };
  } catch {
    return { breached: false };
  }
}
