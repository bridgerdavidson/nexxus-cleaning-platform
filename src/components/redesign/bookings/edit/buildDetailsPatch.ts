import { jobPriceError } from '@/lib/pricing/minJobPrice';
import type { EditDetailsState } from './seedEditDetails';

/**
 * Whether the edit changes the price inputs relative to the seeded state. Mirrors the
 * details route's change detection (service, checklist, or override differs), which is
 * what decides whether the save rewrites total_price at all.
 */
export function isPriceAffectingEdit(initial: EditDetailsState, s: EditDetailsState): boolean {
  return (
    s.serviceTypeId !== initial.serviceTypeId ||
    s.checklistId !== initial.checklistId ||
    s.overrideEnabled !== initial.overrideEnabled ||
    (s.overrideEnabled && s.overrideTotal !== initial.overrideTotal)
  );
}

/**
 * The blocking price message for the edit form, or null. Only a price-affecting edit is
 * checked (same as the route and the require_min_price DB trigger), so a notes-only save
 * on a legacy under-$1 booking is never blocked. `systemTotal` is service base + checklist
 * adder, the price used when the override is off.
 */
export function editDetailsPriceError(
  initial: EditDetailsState,
  s: EditDetailsState,
  systemTotal: number,
): string | null {
  if (!isPriceAffectingEdit(initial, s)) return null;
  return jobPriceError(s.overrideEnabled ? s.overrideTotal : systemTotal);
}

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
