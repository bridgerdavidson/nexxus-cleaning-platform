import { AlertTriangle, Ban, Banknote, Clock, Loader2, XCircle, CalendarClock } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { CleanerStatus, ConnectState, PendingInviteStatus } from "./cleaners-types";

// Status presenters for the Cleaners roster. Reuses the operator color hierarchy:
// amber/caution = needs action, gray/secondary = settled, green/positive = good,
// red/critical = problem. Only states that warrant attention render a badge; a
// healthy/active cleaner stays visually quiet so the problems stand out.

/** Active cleaners render nothing (absence = fine); benched shows a caution pill. */
export function CleanerStatusBadge({ status }: { status: CleanerStatus }) {
  if (status !== "benched") return null;
  return (
    <Badge variant="secondary" className="shrink-0 whitespace-nowrap">
      <Ban /> Benched
    </Badge>
  );
}

/** "Can't get paid" warning when Connect is not finished; nothing when ready. */
export function ConnectBadge({ state }: { state: ConnectState }) {
  if (state === "ready") return null;
  return (
    <Badge variant="caution" className="shrink-0 whitespace-nowrap">
      <AlertTriangle /> Can&apos;t get paid
    </Badge>
  );
}

/** Amber alert: money owed to the cleaner that has not been sent yet
 *  (pending + approved payouts). Only shown when there is something owed. */
export function OwedBadge({ label }: { label: string }) {
  return (
    <Badge variant="caution" className="shrink-0 whitespace-nowrap">
      <Banknote /> Owed {label}
    </Badge>
  );
}

/** Red alert: a payout to this cleaner failed or was reversed. */
export function FailedPayoutBadge() {
  return (
    <Badge variant="critical" className="shrink-0 whitespace-nowrap">
      <AlertTriangle /> Payout failed
    </Badge>
  );
}

type InviteConfig = {
  label: string;
  variant: BadgeProps["variant"];
  Icon: React.ComponentType<{ className?: string }>;
  spin?: boolean;
};

const INVITE_STATUS: Record<PendingInviteStatus, InviteConfig> = {
  pending: { label: "Pending", variant: "caution", Icon: Clock },
  creating: { label: "Sending", variant: "secondary", Icon: Loader2, spin: true },
  failed: { label: "Failed", variant: "critical", Icon: XCircle },
  expired: { label: "Expired", variant: "secondary", Icon: CalendarClock },
};

export function InviteStatusBadge({ status }: { status: PendingInviteStatus }) {
  const c = INVITE_STATUS[status] ?? INVITE_STATUS.pending;
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}
