/**
 * Pure presenter functions for the active-job flow.
 * No React imports — safe to unit-test without DOM.
 */

/**
 * Human-readable summary of the photo capture state for a single phase
 * (before or after).
 *
 * @param confirmed - Count of photos that have finished uploading and are
 *   persisted in the database.
 * @param inFlight  - Count of photos currently queued, converting,
 *   compressing, or uploading.
 */
export function photoStatusLabel(confirmed: number, inFlight: number): string {
  if (confirmed === 0 && inFlight === 0) return 'No photos yet';

  const parts: string[] = [];

  if (confirmed > 0) {
    parts.push(`${confirmed} ${confirmed === 1 ? 'photo' : 'photos'} added`);
  }

  if (inFlight > 0) {
    parts.push(`${inFlight} uploading`);
  }

  return parts.join(', ');
}

/**
 * Human-readable progress summary for a checklist.
 *
 * @param done  - Number of completed line items.
 * @param total - Total line items in the checklist.
 */
export function checklistProgressLabel(done: number, total: number): string {
  if (total === 0) return 'No tasks';
  if (done >= total) return `All ${total} done`;
  return `${done} of ${total} done`;
}
