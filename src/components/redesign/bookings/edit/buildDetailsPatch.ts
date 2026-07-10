import type { EditDetailsState } from './seedEditDetails';

/** Body for PATCH /api/appointments/[appointmentId]/details. */
export interface DetailsPatchBody {
  serviceTypeId: string;
  checklistId: string | null;
  priceOverrideEnabled: boolean;
  priceOverrideTotal: number | null;
  specialRequests: string | null;
  notes: string | null;
}

/**
 * Builds the PATCH body from form state. Requests/notes trim to null when
 * blank (mirrors the route's own trim, so a whitespace-only save reads back
 * the same as an empty one). The override total is always nulled when the
 * override is off, regardless of what a stale input still holds, so the
 * enabled/total pair sent to the server is never the inconsistent
 * `enabled: true, total: null` shape that seedEditDetails treats as noise.
 */
export function buildDetailsPatch(s: EditDetailsState): DetailsPatchBody {
  if (!s.serviceTypeId) {
    throw new Error('A service must be selected before saving.');
  }
  const specialRequests = s.specialRequests.trim();
  const notes = s.notes.trim();
  return {
    serviceTypeId: s.serviceTypeId,
    checklistId: s.checklistId ?? null,
    priceOverrideEnabled: s.overrideEnabled,
    priceOverrideTotal: s.overrideEnabled ? s.overrideTotal : null,
    specialRequests: specialRequests ? specialRequests : null,
    notes: notes ? notes : null,
  };
}
