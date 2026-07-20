import { Badge } from '@/components/ui/badge';
import type { CleanerAvailability, CleanerLike } from '@/lib/cleanerAvailability';
import type { PickerItem } from './new-booking/EntityPickerField';

/**
 * Map availability-ranked cleaners to `EntityPickerField` items so the assign
 * flows (Reschedule dialog, booking-detail assign field) render one identical
 * cleaner list: name + "Available" / "Busy (n)" sublabel + a Free/Busy badge.
 *
 * When `withAvailability` is false the rows are just names. That is the
 * no-candidate case: the ranker reports everyone `isAvailable: true` by
 * default, so showing a "Free" badge there would falsely claim we checked an
 * unknown slot.
 */
export function cleanerPickerItems<C extends CleanerLike & { name: string }>(
  ranked: CleanerAvailability<C>[],
  withAvailability: boolean,
): PickerItem[] {
  return ranked.map((r) => ({
    id: r.cleaner.id,
    label: r.cleaner.name,
    sublabel: withAvailability ? (r.isAvailable ? 'Available' : `Busy (${r.conflicts.length})`) : undefined,
    badge: withAvailability ? (
      <Badge variant={r.isAvailable ? 'positive' : 'caution'} className="ml-2">
        {r.isAvailable ? 'Free' : 'Busy'}
      </Badge>
    ) : undefined,
  }));
}
