import { computeChargeBreakdown } from './processingFee';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { computeSelfPayAmounts } from './selfPayMath';

/**
 * The complete, unredacted breakdown computed by {@link projectCompletionCharge}.
 * Every field is always present. The presenter ({@link presentChargeProjection})
 * decides which fields are exposed to the cleaner under the org's pay-display
 * setting, so this internal shape never travels to the client directly.
 */
export interface FullChargeBreakdown {
  baseCents: number;
  method: 'card' | 'us_bank_account';
  chargeCents: number;
  feeCents: number;
  cleanerCutCents: number;
  /**
   * The platform's per-appointment fee. Self-pay: added on top of the cut (part of
   * chargeCents). Homeowner: retained out of the tenant remainder (not part of the
   * customer's charge).
   */
  platformFeeCents: number;
  payoutPercent: number;
  isSelfPay: boolean;
}

export interface ProjectCompletionChargeInput {
  baseCents: number;
  method: 'card' | 'us_bank_account';
  isSelfPay: boolean;
  /** Cleaner's percentage of gross, 0..100. */
  payoutPercent: number;
  /** Platform fee in basis points, 0..10000. */
  platformFeeBps: number;
  /**
   * Whether the processing fee is passed through to the homeowner. Mirrors the
   * actual charge path (chargeCompletedAppointment.ts): when off, the customer is
   * charged the base with zero fee. Ignored for self-pay, which always grosses up.
   */
  feePassthrough: boolean;
}

/**
 * Projects the exact charge and cleaner cut for the Complete sheet.
 * Composes three existing helpers without duplicating any math.
 */
export function projectCompletionCharge(input: ProjectCompletionChargeInput): FullChargeBreakdown {
  const { baseCents, method, isSelfPay, payoutPercent, platformFeeBps, feePassthrough } = input;

  if (isSelfPay) {
    const sp = computeSelfPayAmounts({ jobGrossCents: baseCents, payoutPercent, platformFeeBps, method });
    return {
      baseCents,
      method,
      chargeCents: sp.chargeCents,
      feeCents: sp.estimatedFeeCents,
      cleanerCutCents: sp.cleanerCutCents,
      platformFeeCents: sp.platformFeeCents,
      payoutPercent,
      isSelfPay: true,
    };
  }

  // Match chargeCompletedAppointment.ts: only gross the charge up for the processing
  // fee when passthrough is on; otherwise charge the base with zero fee.
  const { chargeCents, feeCents } = feePassthrough
    ? computeChargeBreakdown(method, baseCents)
    : { chargeCents: baseCents, feeCents: 0 };
  const split = computePaymentSplit({ grossCents: baseCents, payoutPercent, platformFeeBps });
  return {
    baseCents,
    method,
    chargeCents,
    feeCents,
    cleanerCutCents: split.cleanerCents,
    platformFeeCents: split.platformFeeCents,
    payoutPercent,
    isSelfPay: false,
  };
}
