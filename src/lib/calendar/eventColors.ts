/**
 * Status -> event-chip visual mapping, derived from the canonical StatusBadge palette
 * (`src/components/StatusBadge.tsx`). Guards against the old calendar's drift (it painted
 * in_progress purple; canonical is cyan). Class strings are LITERAL so Tailwind's JIT picks
 * them up (no `bg-${family}-100` interpolation).
 *
 * Also exposes `paymentProblemPill`: the payment chip is only shown on a calendar event when
 * it represents a money problem (Unpaid / Failed / Auth failed / Action needed), to keep
 * chips quiet for the healthy majority.
 */
import {
  paymentStatusPill,
  type PaymentPill,
  type PillPaymentStatus,
  type PillAuthorizationStatus,
} from '../paymentStatusPill';

export interface StatusVisual {
  /** Color family key (for tests + grouping); e.g. 'cyan' for in_progress. */
  key: string;
  label: string;
  /** Background + text classes for a solid chip. */
  chipClass: string;
  /** Left accent bar background. */
  barClass: string;
  /** Status dot background. */
  dotClass: string;
}

const VISUALS: Record<string, StatusVisual> = {
  pending: { key: 'amber', label: 'Pending', chipClass: 'bg-amber-100 text-amber-800', barClass: 'bg-amber-500', dotClass: 'bg-amber-500' },
  confirmed: { key: 'blue', label: 'Confirmed', chipClass: 'bg-blue-100 text-blue-800', barClass: 'bg-blue-500', dotClass: 'bg-blue-500' },
  in_progress: { key: 'cyan', label: 'In progress', chipClass: 'bg-cyan-100 text-cyan-800', barClass: 'bg-cyan-500', dotClass: 'bg-cyan-500' },
  completed: { key: 'emerald', label: 'Done', chipClass: 'bg-emerald-100 text-emerald-800', barClass: 'bg-emerald-500', dotClass: 'bg-emerald-500' },
  cancelled: { key: 'slate', label: 'Cancelled', chipClass: 'bg-slate-100 text-slate-500 line-through', barClass: 'bg-slate-400', dotClass: 'bg-slate-400' },
  counter_proposed: { key: 'orange', label: 'Counter-proposed', chipClass: 'bg-orange-100 text-orange-800', barClass: 'bg-orange-500', dotClass: 'bg-orange-500' },
};

const DEFAULT_VISUAL: Omit<StatusVisual, 'label'> = {
  key: 'gray',
  chipClass: 'bg-gray-100 text-gray-700',
  barClass: 'bg-gray-400',
  dotClass: 'bg-gray-400',
};

export function statusVisual(
  status: string,
  opts?: {
    cleanerConfirmationStatus?: 'awaiting' | 'approved' | 'rejected' | null;
    hasSuggestedTimes?: boolean;
  },
): StatusVisual {
  // A cleaner who rejected with suggested times surfaces as "Counter-proposed"; a hard
  // decline collapses back into the pending bucket (mirrors StatusBadge).
  if (opts?.cleanerConfirmationStatus === 'rejected') {
    return opts.hasSuggestedTimes ? VISUALS.counter_proposed : VISUALS.pending;
  }
  return VISUALS[status?.toLowerCase()] ?? { ...DEFAULT_VISUAL, label: status || 'Scheduled' };
}

/** Payment-attention labels worth surfacing on a calendar chip. */
const PROBLEM_LABELS = new Set(['Unpaid', 'Failed', 'Auth failed', 'Action needed']);

/** Returns the payment pill ONLY when it is a money problem, else null (chip stays quiet). */
export function paymentProblemPill(
  paymentStatus: PillPaymentStatus,
  authorizationStatus?: PillAuthorizationStatus,
): PaymentPill | null {
  const pill = paymentStatusPill(paymentStatus, authorizationStatus);
  return PROBLEM_LABELS.has(pill.label) ? pill : null;
}
