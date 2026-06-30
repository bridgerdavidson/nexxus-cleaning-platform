import type { Appointment } from '@/hooks/useHomeownerData';

export type CleaningSectionKey = 'upcoming' | 'past';

export interface CleaningSection {
  key: CleaningSectionKey;
  label: string;
  appointments: Appointment[];
}

const UPCOMING_STATUSES = new Set<Appointment['status']>(['pending', 'confirmed', 'in_progress']);

const keyOf = (a: Appointment) => `${a.scheduled_date ?? ''} ${a.scheduled_time ?? ''}`;
const byWhenAsc = (a: Appointment, b: Appointment) => keyOf(a).localeCompare(keyOf(b));
const byWhenDesc = (a: Appointment, b: Appointment) => -byWhenAsc(a, b);

export function deriveCleanings(appointments: Appointment[]): {
  sections: CleaningSection[];
  total: number;
  isEmpty: boolean;
} {
  const upcoming = appointments.filter((a) => UPCOMING_STATUSES.has(a.status)).sort(byWhenAsc);
  const past = appointments.filter((a) => !UPCOMING_STATUSES.has(a.status)).sort(byWhenDesc);

  const sections: CleaningSection[] = [];
  if (upcoming.length) sections.push({ key: 'upcoming', label: 'Upcoming', appointments: upcoming });
  if (past.length) sections.push({ key: 'past', label: 'Past', appointments: past });

  return { sections, total: appointments.length, isEmpty: appointments.length === 0 };
}
