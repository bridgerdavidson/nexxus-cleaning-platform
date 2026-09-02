import { computeSelfPayAmountsFromCents } from "@/lib/payments/selfPayMath";
import { money2 } from "./payments-presenters";

/** Coarse "how long has this been waiting" label; the queue is day-scale work. */
export function agoLabel(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type MarginTone = "positive" | "caution" | "critical" | "neutral";

/**
 * What the company card would be charged for a company-pays amount: the
 * amount plus the platform fee on the job price, grossed up for the card fee.
 * Same math as the self-pay charge (computeSelfPayAmountsFromCents). Card is
 * assumed because the saved method is not known client-side, so copy around
 * it says "about". Bad input reads as $0 rather than throwing mid-render.
 */
export function selfPayChargeEstimateCents(args: {
  jobPriceCents: number;
  amountCents: number;
  platformFeeBps: number;
}): number {
  const { jobPriceCents, amountCents, platformFeeBps } = args;
  if (!Number.isInteger(amountCents) || amountCents < 0) return 0;
  if (!Number.isInteger(jobPriceCents) || jobPriceCents < 0) return 0;
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) return 0;
  return computeSelfPayAmountsFromCents({
    jobGrossCents: jobPriceCents,
    cleanerCutCents: amountCents,
    platformFeeBps,
    method: "card",
  }).chargeCents;
}

/**
 * Margin phrased as text + tone so the money story never rides on hue alone.
 * A company-pays thread has no margin (the org funds the amount, whatever the
 * job price says), so its line is the estimated charge in a neutral tone.
 */
export function marginLine(r: {
  marginCents: number;
  marginPct: number | null;
  isSelfPay?: boolean;
  selfPayChargeCents?: number | null;
}): {
  text: string;
  tone: MarginTone;
} {
  if (r.isSelfPay) {
    return {
      text: `Company pays about ${money2((r.selfPayChargeCents ?? 0) / 100)} with fees`,
      tone: "neutral",
    };
  }
  if (r.marginCents < 0) {
    return {
      text: `Above job price by ${money2(Math.abs(r.marginCents) / 100)}`,
      tone: "critical",
    };
  }
  const pct = r.marginPct != null ? ` (${r.marginPct}%)` : "";
  return {
    text: `Leaves you ${money2(r.marginCents / 100)}${pct}`,
    tone: r.marginCents === 0 ? "caution" : "positive",
  };
}
