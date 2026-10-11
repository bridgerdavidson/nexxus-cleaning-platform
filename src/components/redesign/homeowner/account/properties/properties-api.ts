import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { BookingUnavailableError, isBookingBlockedResponse } from '../../bookingUnavailable';
import type { Property } from '@/hooks/useHomeownerData';

export interface CreatePropertyBody {
  organization_id: string;
  /** Operators name the homeowner; a homeowner caller is always the owner and may omit this. */
  owner_id?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  special_instructions: string | null;
  access_instructions: string | null;
}

/**
 * POST /api/properties directly, NOT via apiFetch. This is the "Add a home" path (ruling
 * R18): a homeowner adding their own property, reachable from both the booking flow's
 * property picker and Settings > Properties. apiFetch's 402 net opens the owner-only paywall
 * (usePaywall.openPaywall) and hands back a promise that never resolves, both wrong here.
 * Throws BookingUnavailableError instead so the caller renders the persistent homeowner
 * notice, the same as the booking-request path.
 */
export async function createPropertyApi(body: CreatePropertyBody): Promise<Property> {
  const token = await getAccessToken();
  const res = await fetch('/api/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (isBookingBlockedResponse(res.status, data)) throw new BookingUnavailableError();
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not save the property.');
  return data.data as Property;
}
