// Task 10a (PR F, plumbing half): the parts of the seat-cap feature that must
// exist before SeatCapDialog (a follow-up task) can open, plus two small bits
// of seat messaging. Three pure decisions, kept out of OperatorCleaners.tsx
// for the same reason every other billing decision in this repo lives in a
// model file: this codebase has no component-rendering setup and
// @testing-library/react is not installed, so a rule left inside a .tsx file
// has no test coverage. See billingSectionModel.ts for the established
// pattern; seatMessagingModel.test.ts guards the wiring the same way
// billingActionParity.test.ts guards BillingSection.tsx.
//
// Reference: .superpowers/sdd/2026-09-21-phase1f-billing-ui/task-10-brief.md

import type { BillingAccess } from '@/lib/billing/access'

// ---------------------------------------------------------------------------
// 1. Classify the send-invite response.
//
// POST /api/admin/send-invite returns 409 with { error: 'seat_cap_reached',
// cap, in_use, tier, next_tier } when the org is at its purchased-seat cap
// (src/app/api/admin/send-invite/route.ts). Before this task the caller
// collapsed the response into `result.error` and toasted it verbatim, so an
// operator read the raw string "seat_cap_reached" (the bug this exists to
// fix). The opposite mistake is just as real: swallowing a genuine error
// (network failure, validation 400, etc.) instead of toasting it because it
// merely LOOKS like the seat-cap shape.
// ---------------------------------------------------------------------------

export interface InviteResultLike {
  success: boolean
  status?: number
  body?: unknown
  error?: string
}

export type InviteOutcome =
  | { kind: 'sent' }
  | { kind: 'seat_cap' }
  | { kind: 'error'; message: string }

const DEFAULT_INVITE_ERROR = 'Could not send the invite'

export function classifyInviteResult(r: InviteResultLike): InviteOutcome {
  if (r.success) return { kind: 'sent' }

  const body = r.body as { error?: unknown } | null | undefined
  if (r.status === 409 && body != null && body.error === 'seat_cap_reached') {
    return { kind: 'seat_cap' }
  }

  return { kind: 'error', message: r.error || DEFAULT_INVITE_ERROR }
}

// ---------------------------------------------------------------------------
// 2. The seat indicator beside the Invite button.
//
// Wording follows Airtable's precedent ("2 of 4 seats available"), inverted
// to used-of-total because the cap is a purchase, not an allowance. When a
// pending invite reserves a seat, it is named rather than folded silently
// into the total (the ClickUp/Loom complaint pattern our model avoids).
//
// During a trial the flat 15-seat cap is shown only once reached (spec §13);
// below the cap, nothing renders. "During a trial" is plan_tier == null, the
// same definition SeatCapDialog's Case 0 uses.
// ---------------------------------------------------------------------------

export interface SeatIndicatorInput {
  uiEnabled: boolean
  access: BillingAccess | null
  seatsInUse: number
  /**
   * Pending cleaner invites that actually reserve a seat: status ===
   * 'pending' only, matching countSeatsInUse server-side. 'creating',
   * 'failed' and 'expired' invites are shown elsewhere in the roster but
   * consume no seat.
   */
  pendingCount: number
  /** organizations.plan_tier == null. */
  isTrial: boolean
}

export function seatIndicatorText(input: SeatIndicatorInput): string | null {
  const { uiEnabled, access, seatsInUse, pendingCount, isTrial } = input
  if (!uiEnabled || !access || access.seatCap == null) return null

  const cap = access.seatCap
  if (isTrial && seatsInUse < cap) return null

  if (pendingCount > 0) {
    const active = Math.max(seatsInUse - pendingCount, 0)
    return `${active} active and ${pendingCount} pending of ${cap} seats`
  }

  return `${seatsInUse} of ${cap} seats used`
}

// ---------------------------------------------------------------------------
// 3. The post-delete seat toast.
//
// Removing a cleaner member always frees exactly one purchased seat, so the
// post-delete count is whatever seatsInUse was immediately before the delete,
// minus one. Deliberately not computed from a post-delete refetch: the
// billing query has its own staleTime and the toast must not block on it.
// ---------------------------------------------------------------------------

export interface PostDeleteSeatToastInput {
  uiEnabled: boolean
  access: BillingAccess | null
  /** seatsInUse as read BEFORE the delete mutation ran. */
  seatsInUseBeforeDelete: number
}

export function postDeleteSeatToastMessage(input: PostDeleteSeatToastInput): string | null {
  const { uiEnabled, access, seatsInUseBeforeDelete } = input
  if (!uiEnabled || !access || access.seatCap == null) return null

  const n = Math.max(seatsInUseBeforeDelete - 1, 0)
  return `That frees one seat. You now have ${n} of ${access.seatCap} seats in use.`
}
