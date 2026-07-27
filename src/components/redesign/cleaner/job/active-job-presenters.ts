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

/**
 * Format a cent amount as a dollar string, e.g. 12000 -> '$120.00'.
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Outcome of the pay request a request-mode cleaner submitted at completion. */
export interface PayRequestOutcome {
  submitted: boolean;
  autoApproved: boolean;
  amountCents: number;
}

/**
 * Copy for the job-complete success state. Title is always "Job complete".
 * Body varies by chargeOutcome. Never blames the cleaner. No em dashes.
 *
 * Reachable outcomes from useCompleteJob: 'charged' | 'processing' | 'failed'.
 * Defensive extras: 'declined' | 'no_card' | 'requires_action'.
 *
 * When a pay request was submitted, ITS outcome is the story and takes
 * precedence over the charge outcome: a request-mode cleaner's pay does not
 * depend on whether the customer's card cleared (that is the operator's
 * problem), so they must never see the payment-issue copy in its place.
 */
export function completeSuccessCopy(
  outcome: string | undefined,
  cleanerCutCents: number,
  opts?: { payRequest?: PayRequestOutcome },
): { title: string; body: string } {
  const title = 'Job complete';

  const pr = opts?.payRequest;
  if (pr?.submitted) {
    return pr.autoApproved
      ? {
          title,
          body: `You earned ${formatCents(pr.amountCents)}. It is on its way.`,
        }
      : {
          title,
          body: `Your request for ${formatCents(pr.amountCents)} was sent for approval. You'll get a notification when it's reviewed.`,
        };
  }

  switch (outcome) {
    case 'charged':
      return {
        title,
        body: `Payment collected. Your cut of ${formatCents(cleanerCutCents)} is on its way.`,
      };

    case 'processing':
      return {
        title,
        body: `The job is recorded. Payment is processing via bank transfer and will arrive once it clears.`,
      };

    case 'declined':
    case 'no_card':
    case 'requires_action':
    case 'failed':
    default:
      return {
        title,
        body: `The job is marked complete. There was a payment issue on the customer side. The operator has been notified and will sort it out.`,
      };
  }
}
