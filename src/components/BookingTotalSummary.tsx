"use client";

import { computeChargeBreakdown, type PaymentMethodKind } from "@/lib/payments/processingFee";
import { stripeFeePassthroughUiEnabled } from "@/lib/stripe/flags";

interface BookingTotalSummaryProps {
  /** Service price in dollars (e.g. an appointment's total_price or a service base_price). */
  servicePrice: number;
  /** Selected payment method; drives the method-aware processing fee. Defaults to card. */
  method?: PaymentMethodKind;
  /** Short charge-timing note, e.g. "Charged when the job is completed". */
  timingNote?: string;
  className?: string;
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Compact, itemized cost summary for the booking flows so the payer sees exactly
 * what they'll be charged before they commit. Reuses the app's `bg-primary-50`
 * info-box pattern. The processing-fee line only appears when the fee-passthrough
 * flag is on; until then it simply shows the service total (still a confidence win
 * over the current "no total before submit"). Method-aware: card vs bank changes
 * the fee and the total.
 */
export default function BookingTotalSummary({
  servicePrice,
  method = "card",
  timingNote,
  className = "",
}: BookingTotalSummaryProps) {
  const baseCents = Math.round((Number(servicePrice) || 0) * 100);
  if (baseCents <= 0) return null;

  const feeEnabled = stripeFeePassthroughUiEnabled();
  const { feeCents, chargeCents } = feeEnabled
    ? computeChargeBreakdown(method, baseCents)
    : { feeCents: 0, chargeCents: baseCents };
  const showFee = feeEnabled && feeCents > 0;

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
              <dt className="text-gray-600">Service</dt>
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
          <dt>Total</dt>
          <dd className="tabular-nums">{formatUsd(chargeCents)}</dd>
        </div>
      </dl>
      {timingNote && <p className="mt-2 text-xs text-gray-500">{timingNote}</p>}
    </div>
  );
}
