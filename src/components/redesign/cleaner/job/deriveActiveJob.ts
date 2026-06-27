import type { ActiveJobGateInput, ActiveJobGate } from './active-job-types';

export function deriveActiveJob(input: ActiveJobGateInput): ActiveJobGate {
  const { requireJobPhotos, photosSkipped, beforeSatisfied, afterSatisfied } = input;
  const beforeNeeded = requireJobPhotos && !photosSkipped && !beforeSatisfied;
  const afterNeeded = requireJobPhotos && !photosSkipped && !afterSatisfied;
  const photoGateMet = !requireJobPhotos || photosSkipped || (beforeSatisfied && afterSatisfied);
  const remaining: string[] = [];
  if (beforeNeeded) remaining.push('Add a before photo');
  if (afterNeeded) remaining.push('Add an after photo');
  return { photoGateMet, beforeNeeded, afterNeeded, canComplete: photoGateMet, remaining };
}
