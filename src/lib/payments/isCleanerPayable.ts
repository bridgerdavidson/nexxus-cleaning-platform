/**
 * "Is this cleaner payout-capable?" predicate (pure, client-safe).
 *
 * A self-pay appointment charges the org's company card for the cleaner's cut and transfers it
 * to the cleaner's Connect account. That only works if the assigned cleaner can actually receive
 * a payout, so the booking modal disables (and the submit blocks on) any cleaner who isn't ready.
 *
 * The conditions mirror the server-side authorizer (authorizeSelfPayAppointment) exactly so the
 * UI never offers a cleaner the backend would then reject:
 *   - Connect onboarding complete (stripe_connect_onboarding_complete === true), AND
 *   - a Connect account on file (stripe_connect_account_id present — implied by the above, but
 *     checked so a half-provisioned row can't slip through), AND
 *   - not an hourly_external cleaner (payout_model !== 'hourly_external' — those are paid outside
 *     the app, so there's no transfer to make), AND
 *   - a positive payout percentage (payout_percent > 0 — the charge amount is derived from it).
 *
 * Pure + dependency-free so it unit-tests in isolation and can drive both the cleaner-row gate
 * and the submit-disabled logic without re-deriving the rule.
 */

export interface CleanerPayoutFields {
  payout_model?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_connect_onboarding_complete?: boolean | null;
  payout_percent?: number | string | null;
}

export function isCleanerPayable(cleaner: CleanerPayoutFields | null | undefined): boolean {
  if (!cleaner) return false;
  return (
    cleaner.stripe_connect_onboarding_complete === true &&
    !!cleaner.stripe_connect_account_id &&
    cleaner.payout_model !== 'hourly_external' &&
    Number(cleaner.payout_percent) > 0
  );
}
