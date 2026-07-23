/**
 * Cancellation / no-show fee policy math (decision #10).
 *
 * A fee applies ONLY to a homeowner-caused cancel/no-show that is either a no-show or falls
 * inside the org's cancellation window. Cleaner-caused cancels and on-time homeowner cancels
 * are free (the hold is released). Pure + side-effect-free so it's unit-testable.
 */
export interface CancellationFeeArgs {
  party: 'homeowner' | 'cleaner' | 'org';
  noShow: boolean;
  grossCents: number;
  windowHours: number;
  /**
   * Late-cancel (inside-window) fee policy, from `organizations.cancellation_fee_*`.
   */
  feeType: string; // 'none' | 'flat' | 'percent'
  feeValue: number; // dollars (flat) or percent (percent)
  /**
   * No-show fee policy, from `organizations.no_show_fee_*` — INDEPENDENT of the late-cancel policy
   * (T1-6, decision B / strict independence). A no-show is billed strictly by this policy and never
   * inherits the late-cancel fee. Required (not defaulted) so no caller can silently fall back to $0
   * on a real no-show, which is the exact bug T1-6 fixes.
   */
  noShowFeeType: string; // 'none' | 'flat' | 'percent'
  noShowFeeValue: number; // dollars (flat) or percent (percent)
  scheduledDate: string | null;
  scheduledTime: string | null;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
}

export function computeCancellationFee(
  args: CancellationFeeArgs,
): { feeCents: number; insideWindow: boolean } {
  const insideWindow = isInsideWindow(
    args.scheduledDate,
    args.scheduledTime,
    args.windowHours,
    args.now ?? Date.now(),
  );

  // A fee applies only to a homeowner-caused no-show or an inside-window cancel.
  const applies = args.party === 'homeowner' && (args.noShow || insideWindow);
  if (!applies) return { feeCents: 0, insideWindow };

  // Strict independence (decision B): a no-show reads ONLY the no-show policy; a late (inside-window)
  // cancel reads ONLY the late-cancel policy. A no-show does not inherit the late-cancel fee, and a
  // late cancel does not inherit the no-show fee.
  const feeType = args.noShow ? args.noShowFeeType : args.feeType;
  const feeValue = args.noShow ? args.noShowFeeValue : args.feeValue;
  if (feeType === 'none' || feeValue <= 0) {
    return { feeCents: 0, insideWindow };
  }

  let feeCents = 0;
  if (feeType === 'flat') {
    feeCents = Math.round(feeValue * 100);
  } else if (feeType === 'percent') {
    feeCents = Math.round((args.grossCents * feeValue) / 100);
  }
  return { feeCents: Math.max(0, Math.min(feeCents, args.grossCents)), insideWindow };
}

/** True when `now` is within `windowHours` before the scheduled start, or past it. */
export function isInsideWindow(
  scheduledDate: string | null,
  scheduledTime: string | null,
  windowHours: number,
  now: number,
): boolean {
  if (!scheduledDate) return false;
  const iso = scheduledTime ? `${scheduledDate}T${scheduledTime}` : `${scheduledDate}T00:00:00`;
  const scheduled = new Date(iso);
  if (Number.isNaN(scheduled.getTime())) return false;
  const windowStart = scheduled.getTime() - windowHours * 60 * 60 * 1000;
  return now >= windowStart;
}
