// Task 12: eight separate triggers across the operator shell all open the
// new-booking sheet the same way, by setting ?newbooking=1 (OperatorTopBar,
// the mobile FAB, the command palette, the calendar toolbar and its
// empty-slot clicks, the Bookings page, a customer/property's "Book" action,
// and Messages). Gating each of those call sites individually is how one
// gets missed; instead OperatorBookingHost.tsx (the single renderer of the
// sheet) intercepts the param itself. This file holds that decision as a
// pure function, per the repo's standing decision that a rule left inside a
// .tsx file has no test coverage here (no component-rendering setup, no
// @testing-library/react).

export interface BookingHostGateInput {
  /** True when the ?newbooking=1 param is present. */
  paramPresent: boolean;
  /** billingEnforcementUiEnabled(). Flag-dark: never gate. */
  uiEnabled: boolean;
  /** access?.frozen ?? false, from useBilling(). */
  frozen: boolean;
  /** useBilling().isOwner. */
  isOwner: boolean;
}

export interface BookingHostGateResult {
  /** Whether OperatorBookingSheet should actually render open. */
  showSheet: boolean;
  /**
   * Whether to call usePaywall().open(). Owner only (ruling R2): a
   * non-owner's click is a no-op, and Task 8's explanation bar carries the
   * reason, so the wall is never opened on their behalf.
   */
  openWall: boolean;
  /**
   * Whether to clear ?newbooking=1 (and its seed params). Also true for a
   * non-owner: the sheet must not stay "open" in the URL with nothing
   * rendering for it, and a later param-driven effect must not re-fire.
   */
  clearParam: boolean;
}

const HIDDEN: BookingHostGateResult = { showSheet: false, openWall: false, clearParam: false };

export function bookingHostGate(input: BookingHostGateInput): BookingHostGateResult {
  if (!input.paramPresent) return HIDDEN;

  const frozen = input.uiEnabled && input.frozen;
  if (frozen) {
    return { showSheet: false, openWall: input.isOwner, clearParam: true };
  }

  return { showSheet: true, openWall: false, clearParam: false };
}
