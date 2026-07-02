import type { Property } from '@/hooks/useHomeownerData';

/** "City, ST" location line (omits missing parts). */
export function propertyLocationLine(p: Pick<Property, 'city' | 'state'>): string {
  return [p.city, p.state].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
}

/** "3 bd · 2 ba · 1,200 sq ft" (omits any missing/zero stat; empty string when none). */
export function propertyStatsLabel(
  p: Pick<Property, 'bedrooms' | 'bathrooms' | 'square_feet'>,
): string {
  const parts: string[] = [];
  if (p.bedrooms) parts.push(`${p.bedrooms} bd`);
  if (p.bathrooms) parts.push(`${p.bathrooms} ba`);
  if (p.square_feet) parts.push(`${p.square_feet.toLocaleString('en-US')} sq ft`);
  return parts.join(' · ');
}
