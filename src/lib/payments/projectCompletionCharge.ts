import type { ChargeProjection } from '@/types';
import { computeChargeBreakdown } from './processingFee';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { computeSelfPayAmounts } from './selfPayMath';

export interface ProjectCompletionChargeInput {
  baseCents: number;
  method: 'card' | 'us_bank_account';
  isSelfPay: boolean;
  /** Cleaner's percentage of gross, 0..100. */
  payoutPercent: number;
  /** Platform fee in basis points, 0..10000. */
  platformFeeBps: number;
}

/**
 * Projects the exact charge and cleaner cut for the Complete sheet.
 * Composes three existing helpers without duplicating any math.
 */
export function projectCompletionCharge(input: ProjectCompletionChargeInput): ChargeProjection {
  const { baseCents, method, isSelfPay, payoutPercent, platformFeeBps } = input;

  if (isSelfPay) {
    const sp = computeSelfPayAmounts({ jobGrossCents: baseCents, payoutPercent, method });
    return {
      baseCents,
      method,
      chargeCents: sp.chargeCents,
      feeCents: sp.estimatedFeeCents,
      cleanerCutCents: sp.cleanerCutCents,
      isSelfPay: true,
    };
  }

  const bd = computeChargeBreakdown(method, baseCents);
  const split = computePaymentSplit({ grossCents: baseCents, payoutPercent, platformFeeBps });
  return {
    baseCents,
    method,
    chargeCents: bd.chargeCents,
    feeCents: bd.feeCents,
    cleanerCutCents: split.cleanerCents,
    isSelfPay: false,
  };
}
