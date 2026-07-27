/**
 * Pick the home + service to pre-fill a fresh booking with, taken from the
 * homeowner's most recent cleaning so a repeat booking is one tap. Prefers the
 * most recent COMPLETED cleaning ("book my usual again"); falls back to the most
 * recent appointment of any status. Returns null when there's nothing to seed.
 *
 * Pure so it's unit-testable. `appointments` is the cached homeowner list, which
 * arrives ascending by scheduled_date, so the most recent is the last element.
 * The seeded ids are still validated by BookingFlow's stale-prefill guards, so a
 * since-deactivated service or deleted home is dropped rather than submitted.
 */
export interface AppointmentLike {
  property_id?: string | null;
  service_type_id?: string | null;
  status?: string;
}

export interface BookingDefaults {
  propertyId: string | null;
  serviceTypeId: string | null;
}

export function pickBookingDefaults(appointments: AppointmentLike[] | null | undefined): BookingDefaults | null {
  if (!appointments || appointments.length === 0) return null;
  const withIds = appointments.filter((a) => a.property_id && a.service_type_id);
  if (withIds.length === 0) return null;
  const completed = withIds.filter((a) => a.status === 'completed');
  const pool = completed.length > 0 ? completed : withIds;
  const last = pool[pool.length - 1];
  return {
    propertyId: last.property_id ?? null,
    serviceTypeId: last.service_type_id ?? null,
  };
}
