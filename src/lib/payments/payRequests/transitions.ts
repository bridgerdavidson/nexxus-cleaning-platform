import type { PayRequestStatus } from '@/types';

/**
 * Pay-request negotiation state machine (spec §5). Pure validation shared by
 * the submit/approve/counter/respond routes; the routes pair every transition
 * with a compare-and-swap UPDATE guarded on the expected current status, so a
 * concurrent action loses with 0 rows and surfaces as a 409.
 *
 * Consent symmetry: money moves only on a number both sides touched. A
 * cleaner-authored amount can auto-approve because the org's threshold is its
 * standing pre-approval; an org-authored amount always requires the cleaner's
 * accept.
 */

export type PayRequestAction = 'org_approve' | 'org_counter' | 'cleaner_accept' | 'cleaner_counter';

export class PayRequestTransitionError extends Error {
  constructor(current: PayRequestStatus, action: PayRequestAction) {
    super(`Illegal pay-request transition: ${action} from ${current}`);
    this.name = 'PayRequestTransitionError';
  }
}

/** Where a brand-new thread starts. */
export function initialStatus(actor: 'cleaner' | 'org', autoApproved: boolean): PayRequestStatus {
  if (actor === 'org') return 'pending_cleaner';
  return autoApproved ? 'approved' : 'pending_org';
}

export function nextStatus(
  current: PayRequestStatus,
  action: PayRequestAction,
  opts: { autoApproved?: boolean } = {},
): PayRequestStatus {
  if (current === 'pending_org' && action === 'org_approve') return 'approved';
  if (current === 'pending_org' && action === 'org_counter') return 'pending_cleaner';
  if (current === 'pending_cleaner' && action === 'cleaner_accept') return 'approved';
  if (current === 'pending_cleaner' && action === 'cleaner_counter') {
    return opts.autoApproved ? 'approved' : 'pending_org';
  }
  throw new PayRequestTransitionError(current, action);
}
