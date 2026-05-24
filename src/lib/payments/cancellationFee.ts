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
  feeType: string; // 'none' | 'flat' | 'percent'
  feeValue: number; // dollars (flat) or percent (percent)
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

  const homeownerFault = args.party === 'homeowner' && (args.noShow || insideWindow);
  if (!homeownerFault || args.feeType === 'none' || args.feeValue <= 0) {
    return { feeCents: 0, insideWindow };
  }

  let feeCents = 0;
  if (args.feeType === 'flat') {
    feeCents = Math.round(args.feeValue * 100);
  } else if (args.feeType === 'percent') {
    feeCents = Math.round((args.grossCents * args.feeValue) / 100);
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
