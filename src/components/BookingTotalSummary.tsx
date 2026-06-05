"use client";

import { computeChargeBreakdown, type PaymentMethodKind } from "@/lib/payments/processingFee";
import { stripeFeePassthroughUiEnabled } from "@/lib/stripe/flags";

/** A precomputed, itemized charge (used by self-pay, where the charge is the cleaner payout grossed
 *  up for the fee, NOT the service price). All values in integer cents. */
export interface TotalBreakdown {
  baseCents: number;
  feeCents: number;
  chargeCents: number;
  /** Line label for the base amount (e.g. "Cleaner payout"). Defaults to "Service". */
  baseLabel?: string;
  /** Line label for the total (e.g. "Your company card"). Defaults to "Total". */
  totalLabel?: string;
}

interface BookingTotalSummaryProps {
  /** Service price in dollars (homeowner mode). Ignored when `breakdown` is provided. */
  servicePrice?: number;
  /** Selected payment method; drives the method-aware processing fee + the fee-line tag. Defaults to card. */
  method?: PaymentMethodKind;
  /** Explicit precomputed breakdown (self-pay mode). When set, it is shown verbatim and the fee
   *  line always appears (the charge genuinely includes the gross-up), independent of the
   *  fee-passthrough flag. */
  breakdown?: TotalBreakdown;
  /** Short charge-timing note, e.g. "Charged when the job is completed". */
  timingNote?: string;
  className?: string;
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Compact, itemized cost summary for the booking flows so the payer sees exactly what they'll be
 * charged before they commit. Reuses the app's `bg-primary-50` info-box pattern. Two modes:
 *
 *  - Homeowner mode (`servicePrice` + `method`): the charge is the service price grossed up for the
 *    method's fee. The processing-fee line only appears when the fee-passthrough flag is on.
 *  - Self-pay mode (`breakdown`): the org pays the cleaner's cut grossed up for the fee, so the
 *    caller supplies the precomputed base/fee/charge (base = cleaner payout) and the fee line always
 *    shows. Method-aware: card vs bank changes the fee + total.
 */
export default function BookingTotalSummary({
  servicePrice,
  method = "card",
  breakdown,
  timingNote,
  className = "",
}: BookingTotalSummaryProps) {
  let baseCents: number;
  let feeCents: number;
  let chargeCents: number;
  let showFee: boolean;
  let baseLabel = "Service";
  let totalLabel = "Total";

  if (breakdown) {
    baseCents = breakdown.baseCents;
    feeCents = breakdown.feeCents;
    chargeCents = breakdown.chargeCents;
    showFee = feeCents > 0;
    if (breakdown.baseLabel) baseLabel = breakdown.baseLabel;
    if (breakdown.totalLabel) totalLabel = breakdown.totalLabel;
  } else {
    baseCents = Math.round((Number(servicePrice) || 0) * 100);
    const feeEnabled = stripeFeePassthroughUiEnabled();
    const computed = feeEnabled
      ? computeChargeBreakdown(method, baseCents)
      : { feeCents: 0, chargeCents: baseCents };
    feeCents = computed.feeCents;
    chargeCents = computed.chargeCents;
    showFee = feeEnabled && feeCents > 0;
  }

  if (chargeCents <= 0) return null;

  return (
    <div
      className={`rounded-lg bg-primary-50 p-3 text-sm text-gray-800 ${className}`}
      role="group"
      aria-label="Cost summary"
    >
      <dl className="space-y-1.5">
        {showFee && (
          <>
            <div className="flex items-center justify-between">
              <dt className="text-gray-600">{baseLabel}</dt>
              <dd className="tabular-nums">{formatUsd(baseCents)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-600">
                Processing fee
                <span className="ml-1 text-xs text-gray-500">
                  ({method === "us_bank_account" ? "bank" : "card"})
                </span>
              </dt>
              <dd className="tabular-nums">{formatUsd(feeCents)}</dd>
            </div>
          </>
        )}
        <div
          className={`flex items-center justify-between font-semibold text-gray-900 ${
            showFee ? "mt-2 border-t border-primary-200 pt-2" : ""
          }`}
        >
          <dt>{totalLabel}</dt>
          <dd className="tabular-nums">{formatUsd(chargeCents)}</dd>
        </div>
      </dl>
      {timingNote && <p className="mt-2 text-xs text-gray-500">{timingNote}</p>}
    </div>
  );
}
