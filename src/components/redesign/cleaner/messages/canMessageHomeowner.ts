/**
 * Whether the cleaner has a homeowner counterparty to message for this job. A
 * self-pay / org-owned job has no homeowner (`homeowner` is null on the cleaner's
 * appointment), so there is no one to message.
 */
export function canMessageHomeowner(appt: { homeowner?: unknown | null }): boolean {
  return !!appt.homeowner;
}
