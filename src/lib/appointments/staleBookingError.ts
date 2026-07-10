/**
 * Copy shown when a server 404/409 means the booking changed under the
 * operator (concurrent reschedule, cancel, or accept). The reschedule and
 * details routes tag these responses with a structured `stale: true`;
 * accept-counter-proposal predates that convention, so its stale failures
 * are recognized by message instead (see isStaleAcceptError).
 */
export const STALE_BOOKING_MESSAGE = 'This booking changed. Refresh and try again.';

/**
 * A concurrent reschedule can delete or reassign the suggestion behind a
 * stale Accept button (sheet row, bell, action center). accept-counter-
 * proposal then 404s ("Suggested time not found" / "Suggested time does not
 * belong to this appointment") or 409s ("Appointment is not awaiting
 * counter-proposal acceptance"). Those all mean "this booking changed", not
 * a real failure; anything else passes through untouched.
 */
export function isStaleAcceptError(message: string | null | undefined): boolean {
  return !!message && (message.includes('Suggested time') || message.includes('not awaiting'));
}
