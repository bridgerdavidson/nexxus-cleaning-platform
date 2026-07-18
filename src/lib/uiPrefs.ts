'use client';

/**
 * Tiny device-local UI preference store backed by localStorage, for small
 * "remember my last choice" bits (e.g. the calendar view mode). Deliberately
 * NOT for anything security- or correctness-sensitive.
 *
 * SSR-safe: returns null on the server, and swallows storage errors (private
 * mode, disabled storage, quota) so a caller never has to guard the try/catch.
 * Read prefs in an effect (not during render) so a persisted value can't cause
 * a server/client hydration mismatch.
 */
export function getUiPref(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setUiPref(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore: storage disabled / full / private mode
  }
}
