// The homeowner-facing "this company isn't taking new online bookings right now" state.
//
// Ruling R18: the innocent third party. A homeowner is the cleaning company's customer, not
// ours, and when the company's account is frozen (a fact ONLY the company should ever learn)
// a write route 402s. This file is the one place that turns that 402 into homeowner-facing
// copy, and it is deliberately written so the word describing WHY never appears in it: the
// copy is fixed text plus an optional phone number, nothing derived from the 402 body.
//
// Two write paths reach this: BookingFlow.tsx (request a cleaning) and PropertyFormSheet.tsx
// (add a home), both under src/components/redesign/homeowner/. Both throw
// BookingUnavailableError instead of a generic Error so their callers can branch on
// `instanceof` (typo-proof, unlike matching on a message string) and render this message
// instead of a toast that would disappear, or the owner-only paywall that must never reach
// a homeowner at all.

import { isBillingFrozenResponse } from '@/lib/billing/frozenResponse';
import { supabase } from '@/lib/supabase';

/**
 * True for exactly the 402 shape guard.ts's assertOrgWritable produces. Reused rather than
 * re-derived so this file and the owner-only paywall net (frozenResponse.ts) never disagree
 * about what the shape means.
 */
export const isBookingBlockedResponse = isBillingFrozenResponse;

/**
 * Thrown by a homeowner write's mutationFn in place of a generic Error when the write comes
 * back blocked. NEVER carries the response body: nothing about why is worth keeping, and
 * keeping it would only tempt a future caller into rendering a field from it.
 */
export class BookingUnavailableError extends Error {
  constructor() {
    super('booking_unavailable');
    this.name = 'BookingUnavailableError';
  }
}

/**
 * Fixed copy. No template, no interpolation of anything derived from the 402: the only
 * variable in this whole message is the phone number, and it is a separate, optional line.
 */
export const BOOKING_UNAVAILABLE_MESSAGE =
  'This company is not taking new online bookings right now. Your scheduled cleanings are not affected.';

/**
 * The second line, or null to omit it entirely. Never renders "To book, call them at ."
 * for a blank or unset number: an empty label is worse than no line at all.
 */
export function callToBookLine(phone: string | null | undefined): string | null {
  const trimmed = typeof phone === 'string' ? phone.trim() : '';
  return trimmed ? `To book, call them at ${trimmed}.` : null;
}

/**
 * Reads the org's public contact number directly (RLS lets any org member, including a
 * homeowner, select their own organizations row). Only called after a blocked write, so this
 * never widens what loads on every page for every role. Resolves to null on any failure
 * (missing row, RLS surprise, network blip) so the caller falls back to omitting the phone
 * line rather than surfacing a fetch error on top of the blocked message.
 */
export async function fetchOrgContactPhone(organizationId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('contact_phone')
      .eq('id', organizationId)
      .maybeSingle();
    if (error || !data) return null;
    return (data.contact_phone as string | null) ?? null;
  } catch {
    return null;
  }
}
