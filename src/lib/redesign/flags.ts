/**
 * Client flag for the dashboard redesign. Mirrors the stripe-flags convention:
 * exact string compare against "true", NEXT_PUBLIC_ prefix so it is readable
 * on the client. Default off.
 */
export function redesignUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REDESIGN_ENABLED === "true";
}
