import type { SetupStepDef } from './onboardingConfig';

export interface ChecklistItem extends SetupStepDef {
  done: boolean;
  isNext: boolean;
}

export interface ChecklistVM {
  items: ChecklistItem[];
  requiredTotal: number;
  requiredDone: number;
  requiredRemaining: number;
  allRequiredComplete: boolean;
  progressPercent: number;
  nextKey: string | null;
}

/**
 * Pure projection of steps + live signals into a checklist view model.
 * "next" is the first incomplete required step, else the first incomplete
 * optional step. Progress counts REQUIRED steps only.
 */
export function deriveChecklist(steps: SetupStepDef[], signals: Record<string, boolean>): ChecklistVM {
  const done = (s: SetupStepDef) => signals[s.completionKey] === true;

  const firstIncompleteRequired = steps.find((s) => s.required && !done(s));
  const firstIncompleteOptional = steps.find((s) => !s.required && !done(s));
  const nextKey = (firstIncompleteRequired ?? firstIncompleteOptional)?.key ?? null;

  const items: ChecklistItem[] = steps.map((s) => ({ ...s, done: done(s), isNext: s.key === nextKey }));

  const required = steps.filter((s) => s.required);
  const requiredTotal = required.length;
  const requiredDone = required.filter(done).length;
  const requiredRemaining = requiredTotal - requiredDone;
  const allRequiredComplete = requiredRemaining === 0;
  const progressPercent = requiredTotal === 0 ? 100 : Math.round((requiredDone / requiredTotal) * 100);

  return { items, requiredTotal, requiredDone, requiredRemaining, allRequiredComplete, progressPercent, nextKey };
}
