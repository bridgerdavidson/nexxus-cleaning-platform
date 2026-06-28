import type { ActiveJobGateInput, ActiveJobGate } from './active-job-types';

export function deriveActiveJob(input: ActiveJobGateInput): ActiveJobGate {
  const { requireJobPhotos, photosSkipped, beforeSatisfied, afterSatisfied, checklistDone, checklistTotal } = input;
  const beforeNeeded = requireJobPhotos && !photosSkipped && !beforeSatisfied;
  const afterNeeded = requireJobPhotos && !photosSkipped && !afterSatisfied;
  const photoGateMet = !requireJobPhotos || photosSkipped || (beforeSatisfied && afterSatisfied);
  const checklistComplete = checklistTotal === 0 || checklistDone >= checklistTotal;
  const remaining: string[] = [];
  if (beforeNeeded) remaining.push('Add a before photo');
  if (afterNeeded) remaining.push('Add an after photo');
  if (!checklistComplete) remaining.push('Finish the checklist');
  return { photoGateMet, beforeNeeded, afterNeeded, checklistComplete, canComplete: photoGateMet && checklistComplete, remaining };
}
