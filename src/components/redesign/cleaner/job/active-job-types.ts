export interface ActiveJobGateInput {
  requireJobPhotos: boolean;
  photosSkipped: boolean;
  beforeSatisfied: boolean;
  afterSatisfied: boolean;
}

export interface ActiveJobGate {
  canComplete: boolean;
  beforeNeeded: boolean;
  afterNeeded: boolean;
  photoGateMet: boolean;
  remaining: string[];
}

export type ActiveJobScreen = 'overview' | 'before' | 'checklist' | 'after' | 'complete';
