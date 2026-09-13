// Seat accounting for the invite cap. Seats are PURCHASED, not metered: adding
// or removing a cleaner never changes the bill. This module only answers
// "may one more cleaner be invited right now".
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §9.

import type { SupabaseClient } from '@supabase/supabase-js';
import { PLANS, PLAN_TIERS, type PlanTier } from './plans';

/**
 * Cleaner members plus pending cleaner invites.
 *
 * Only `pending` invites reserve a seat. `creating` is transient with no way to
 * clear a stuck row, so counting it would let one failed send consume a seat
 * permanently.
 *
 * `excludeEmail` leaves one address out of the PENDING-INVITE count only, never
 * out of the member count. Resending an invite posts to the same route, and it
 * supersedes the old pending row and promotes a new one, so the pending count is
 * unchanged by the operation. Counting the very invite being resent would refuse
 * a resend at full occupancy and tell the operator to buy a seat for an invite
 * that consumes none, which is the steady state for purchased seats, not an edge
 * case. Pass the same normalized address the invite row is keyed by.
 */
export async function countSeatsInUse(
  supabaseAdmin: SupabaseClient,
  organizationId: string,
  excludeEmail?: string,
): Promise<number> {
  let pendingInvites = supabaseAdmin
    .from('invites')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('role', 'cleaner')
    .eq('status', 'pending');

  if (excludeEmail) {
    pendingInvites = pendingInvites.neq('email', excludeEmail);
  }

  const [members, invites] = await Promise.all([
    // Deliberately NOT filtered by excludeEmail: a member holds a seat whoever
    // the current request is about, and organization_members has no email column.
    supabaseAdmin
      .from('organization_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('role', 'cleaner'),
    pendingInvites,
  ]);

  if (members.error) throw new Error(members.error.message);
  if (invites.error) throw new Error(invites.error.message);

  return (members.count ?? 0) + (invites.count ?? 0);
}

/** A null cap means unlimited (comped), never zero. */
export function seatCapDecision(input: { seatCap: number | null; seatsInUse: number }): { allowed: boolean } {
  if (input.seatCap == null) return { allowed: true };
  return { allowed: input.seatsInUse < input.seatCap };
}

/**
 * The cheapest tier STRICTLY ABOVE `currentTier` whose seat ceiling admits one
 * more than `seatsInUse`, by name. Null when the current tier already admits it
 * (the fix is buying a seat, not changing plan) or when nothing higher exists.
 *
 * Pro's ceiling is null, so without the currentTier argument this would name Pro
 * for any number at all, including for an org already on Pro.
 */
export function nextTierFor(seatsInUse: number, currentTier: PlanTier | null): string | null {
  const needed = seatsInUse + 1;
  const fits = (tier: PlanTier) => {
    const max = PLANS[tier].maxSeats;
    return max == null || max >= needed;
  };

  // Already on a tier that could hold another seat: they need seats, not a plan.
  if (currentTier && fits(currentTier)) return null;

  const startAt = currentTier ? PLAN_TIERS.indexOf(currentTier) + 1 : 0;
  for (const tier of PLAN_TIERS.slice(startAt)) {
    if (fits(tier)) return PLANS[tier].name;
  }
  return null;
}
