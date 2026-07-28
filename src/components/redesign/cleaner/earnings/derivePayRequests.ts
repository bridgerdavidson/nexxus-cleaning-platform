// src/components/redesign/cleaner/earnings/derivePayRequests.ts
import type { CleanerPayThread } from "@/hooks/useCleanerPayRequests";

/**
 * Pure shaping for the cleaner's pay-request rows on the Earnings screen.
 *
 * Two buckets, split by whose turn it is:
 *  - "awaiting"    (pending_org)     the org is reviewing their ask; read-only.
 *  - "yourTurn"    (pending_cleaner) the org countered; they accept or counter back.
 *
 * PRIVACY: nothing here touches the job price. The route never sends it, and
 * the only money on a row is an amount one of the two parties actually named.
 */

export interface PayRequestRow {
  id: string;
  appointmentId: string;
  /** The amount currently on the table. */
  amountCents: number;
  /** Who put it there. */
  offeredBy: "cleaner" | "org";
  jobLabel: string;
  propertyLabel: string | null;
  ageLabel: string;
  /** The note attached to the latest offer, when there is one. */
  latestNote: string | null;
}

export interface PayRequestBuckets {
  awaiting: PayRequestRow[];
  yourTurn: PayRequestRow[];
  /**
   * Agreed, not yet paid out. Bridges the window between approval and the
   * payout row appearing, so just-agreed pay is never invisible.
   */
  agreed: PayRequestRow[];
}

/** Coarse waiting label; this queue moves on a scale of hours and days. */
export function waitLabel(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function toRow(t: CleanerPayThread, now: number): PayRequestRow {
  const latest = t.offers[t.offers.length - 1];
  return {
    id: t.id,
    appointmentId: t.appointmentId,
    // Once agreed, the approved amount is the money; before that it is
    // whatever is currently on the table.
    amountCents: t.approvedAmountCents ?? t.currentOfferCents,
    offeredBy: latest?.actor === "org" ? "org" : "cleaner",
    jobLabel: t.jobLabel,
    propertyLabel: t.propertyLabel,
    ageLabel: waitLabel(latest?.createdAt ?? t.updatedAt, now),
    latestNote: latest?.note ?? null,
  };
}

export function derivePayRequests(
  threads: CleanerPayThread[] | undefined,
  now: number,
): PayRequestBuckets {
  const all = threads ?? [];
  return {
    awaiting: all.filter((t) => t.status === "pending_org").map((t) => toRow(t, now)),
    yourTurn: all.filter((t) => t.status === "pending_cleaner").map((t) => toRow(t, now)),
    agreed: all.filter((t) => t.status === "approved").map((t) => toRow(t, now)),
  };
}
