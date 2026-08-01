/**
 * "Is this cleaner payout-capable?" predicate (pure, client-safe).
 *
 * A self-pay appointment charges the org's company card for the cleaner's cut and transfers it
 * to the cleaner's Connect account. That only works if the assigned cleaner can actually receive
 * a payout, so the booking modal disables (and the submit blocks on) any cleaner who isn't ready.
 *
 * The conditions mirror the server-side authorizer (authorizeSelfPayAppointment) exactly so the
 * UI never offers a cleaner the backend would then reject:
 *   - pay actually configured (payout_configured_at set — a cleaner whose stored mode is only
 *     the column default was never given a pay decision, and 0% must never be what someone
 *     gets paid), AND
 *   - Connect onboarding complete (stripe_connect_onboarding_complete === true), AND
 *   - a Connect account on file (stripe_connect_account_id present — implied by the above, but
 *     checked so a half-provisioned row can't slip through), AND
 *   - not an hourly_external cleaner (payout_model !== 'hourly_external' — those are paid outside
 *     the app, so there's no transfer to make), AND
 *   - a per-mode amount precondition: percentage needs payout_percent > 0, flat needs
 *     flat_rate_cents > 0, and request has none (the amount arrives later via the approved
 *     pay request, so a Connect-ready request cleaner is always payable).
 *
 * Callers must SELECT payout_configured_at: an absent field reads as unconfigured (fail closed),
 * never as configured — the inverse default is exactly what made "0% pay" invisible.
 *
 * Pure + dependency-free so it unit-tests in isolation and can drive both the cleaner-row gate
 * and the submit-disabled logic without re-deriving the rule.
 */

export interface CleanerPayoutFields {
  payout_model?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_connect_onboarding_complete?: boolean | null;
  payout_percent?: number | string | null;
  flat_rate_cents?: number | null;
  payout_configured_at?: string | null;
}

export function isCleanerPayable(cleaner: CleanerPayoutFields | null | undefined): boolean {
  if (!cleaner) return false;
  if (!cleaner.payout_configured_at) return false; // no pay decision was ever made
  if (cleaner.stripe_connect_onboarding_complete !== true) return false;
  if (!cleaner.stripe_connect_account_id) return false;
  const model = cleaner.payout_model;
  if (model === 'hourly_external') return false;
  if (model === 'request') return true; // amount arrives via the approved pay request
  if (model === 'flat') return Number(cleaner.flat_rate_cents) > 0;
  return Number(cleaner.payout_percent) > 0; // percentage (incl. legacy spelling)
}
