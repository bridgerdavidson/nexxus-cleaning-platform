import { formatTimeTo12h } from '@/lib/formatTime';

/** Selectable request times: 8:00 AM to 6:00 PM on the hour, with 12h labels. */
export function bookableTimeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 8; h <= 18; h++) {
    const value = `${String(h).padStart(2, '0')}:00`;
    out.push({ value, label: formatTimeTo12h(value) });
  }
  return out;
}

/** Local date -> "YYYY-MM-DD" (no timezone shift). */
export function toYMD(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
