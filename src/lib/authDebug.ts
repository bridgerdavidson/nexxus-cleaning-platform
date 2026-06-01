// Flag-gated auth/session diagnostics. Off unless NEXT_PUBLIC_AUTH_DEBUG === 'true'.
//
// Purpose: confirm, during a live two-session reproduction, WHERE the
// "blank dashboard while logged in" bug originates — org-load failing/empty,
// the auth event stream, token rotation, or a query being disabled because the
// org id went null. All logs share the `[authdbg #N]` prefix + a monotonic
// counter so the ordering across components is unambiguous in the console.

export const AUTH_DEBUG =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AUTH_DEBUG === 'true';

let seq = 0;

export function authDebug(event: string, data?: Record<string, unknown>): void {
  if (!AUTH_DEBUG) return;
  console.log(`[authdbg #${++seq}] ${event}`, data ?? {});
}

/** Last 6 chars of a JWT — enough to tell two tokens apart without leaking it. */
export function tokenTail(token?: string | null): string {
  if (!token) return 'none';
  return token.slice(-6);
}
