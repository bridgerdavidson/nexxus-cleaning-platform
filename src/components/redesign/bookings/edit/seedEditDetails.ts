import type { AdminAppointment } from '@/hooks/useAdminData';

/**
 * Local editable state for the Edit-details body-swap form (design spec:
 * docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md, "Edit
 * details" section). Seeded once per sheet open from the raw appointment row;
 * the form component owns turning this back into a PATCH body via
 * buildDetailsPatch.
 */
export interface EditDetailsState {
  serviceTypeId: string | null;
  checklistId: string | null;
  overrideEnabled: boolean;
  overrideTotal: number | null;
  specialRequests: string;
  notes: string;
}

/**
 * Seeds the form from a booking row. The legacy pair `price_override_enabled:
 * true, price_override_total: null` is inconsistent noise (not a real
 * override) that predates this feature; it seeds override OFF, same as no
 * override at all, and the price falls back to total_price like usual.
 */
export function seedEditDetails(a: AdminAppointment): EditDetailsState {
  const overrideEnabled = !!a.price_override_enabled && a.price_override_total != null;
  return {
    serviceTypeId: a.service_type_id ?? null,
    checklistId: a.checklist_id ?? null,
    overrideEnabled,
    overrideTotal: overrideEnabled ? Number(a.price_override_total) : null,
    specialRequests: a.special_requests ?? '',
    notes: a.notes ?? '',
  };
}
