import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Hourglass,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Undo2,
  XCircle,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type {
  TxnBadgeKey,
  PayoutBadgeKey,
  DisputeBadgeKey,
  DisputeDeadlineUrgency,
} from "./payments-types";

// Shared presentational atoms so the desktop table and mobile cards render
// status, self-pay, money, and dates identically. Mirrors bookings-presenters.

type BadgeConfig = {
  label: string;
  variant: BadgeProps["variant"];
  Icon: React.ComponentType<{ className?: string }>;
  /** Spin the icon (live work). Respects reduced-motion. */
  spin?: boolean;
};

// Color hierarchy: amber (caution) = needs you, red (critical) = problem,
// gray (secondary) = settled/neutral, blue (info) = informational,
// green (positive) = done.
const BADGE_TXN: Record<TxnBadgeKey, BadgeConfig> = {
  paid: { label: "Paid", variant: "positive", Icon: CheckCircle2 },
  processing: { label: "Clearing", variant: "info", Icon: Loader2, spin: true },
  pending: { label: "Awaiting completion", variant: "caution", Icon: Clock },
  failed: { label: "Failed", variant: "critical", Icon: XCircle },
  refunded: { label: "Refunded", variant: "info", Icon: RotateCcw },
};

const BADGE_PAYOUT: Record<PayoutBadgeKey, BadgeConfig> = {
  paid: { label: "Paid", variant: "positive", Icon: CheckCircle2 },
  held: { label: "Held", variant: "caution", Icon: Hourglass },
  failed: { label: "Failed", variant: "critical", Icon: XCircle },
  reversed: { label: "Reversed", variant: "secondary", Icon: Undo2 },
  approved: { label: "Approved", variant: "info", Icon: Clock },
};

export function TxnStatusBadge({ badge }: { badge: TxnBadgeKey }) {
  const c = BADGE_TXN[badge];
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}

export function PayoutStatusBadge({ badge }: { badge: PayoutBadgeKey }) {
  const c = BADGE_PAYOUT[badge];
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}

export function SelfPayTag() {
  return (
    <Badge variant="info" className="shrink-0 whitespace-nowrap">
      Self-pay
    </Badge>
  );
}

// --- Disputes (chargebacks) ---

const BADGE_DISPUTE: Record<DisputeBadgeKey, BadgeConfig> = {
  needs_response: { label: "Needs response", variant: "critical", Icon: AlertTriangle },
  warning: { label: "Early warning", variant: "caution", Icon: ShieldAlert },
  under_review: { label: "Under review", variant: "info", Icon: Clock },
  won: { label: "Won", variant: "positive", Icon: CheckCircle2 },
  lost: { label: "Lost", variant: "secondary", Icon: XCircle },
  closed: { label: "Closed", variant: "secondary", Icon: Ban },
};

export function DisputeStatusBadge({ badge }: { badge: DisputeBadgeKey }) {
  const c = BADGE_DISPUTE[badge];
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}

/**
 * The evidence-response deadline as a functional pill (not a decorative bar):
 * red when overdue or due within 72h, amber when further out, hidden otherwise.
 * Always carries icon + text so meaning never rides on color alone.
 */
export function DisputeDeadlinePill({
  urgency,
  dueLabel,
}: {
  urgency: DisputeDeadlineUrgency;
  dueLabel: string | null;
}) {
  if (urgency === "none") return null;
  if (urgency === "overdue") {
    return (
      <Badge variant="critical" className="shrink-0 whitespace-nowrap">
        <AlertTriangle />
        Response overdue
      </Badge>
    );
  }
  return (
    <Badge variant={urgency === "soon" ? "critical" : "caution"} className="shrink-0 whitespace-nowrap">
      <Clock />
      Respond by {dueLabel}
    </Badge>
  );
}

/** Ledger-row flag: an OPEN chargeback hit this payment, so it isn't just "Paid". */
export function DisputedTag() {
  return (
    <Badge variant="critical" className="shrink-0 whitespace-nowrap">
      <AlertTriangle />
      Disputed
    </Badge>
  );
}

// --- formatters reused across the payments components ---

export function money2(n: number): string {
  return `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function longDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function methodLabel(m?: string | null): string {
  if (m === "card") return "Card";
  if (m === "ach") return "ACH";
  return "Manual";
}
