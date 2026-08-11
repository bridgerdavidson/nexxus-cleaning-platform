import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  Hourglass,
  Loader2,
  Repeat,
  UserPlus,
  UserX,
  XCircle,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { BookingBadgeKey, BookingPayment } from "./bookings-types";

// Shared presentational atoms so the desktop table and mobile cards render the
// status and payment identically.

type BadgeConfig = {
  label: string;
  variant: BadgeProps["variant"];
  Icon: React.ComponentType<{ className?: string }>;
  /** Spin the icon (in progress = live work). Respects reduced-motion. */
  spin?: boolean;
};

// Color hierarchy: amber = needs you, red = problem, gray = settled (confirmed),
// blue = live (in progress), green = done. Confirmed is intentionally quiet so it
// does not compete with the active blue state.
export const BADGE: Record<BookingBadgeKey, BadgeConfig> = {
  unassigned: { label: "Unassigned", variant: "caution", Icon: UserPlus },
  awaiting_cleaner: { label: "Awaiting cleaner", variant: "caution", Icon: Hourglass },
  counter_proposed: { label: "Counter-proposed", variant: "caution", Icon: Repeat },
  pending: { label: "Pending", variant: "caution", Icon: Clock },
  declined: { label: "Declined", variant: "critical", Icon: UserX },
  cancelled: { label: "Cancelled", variant: "critical", Icon: XCircle },
  confirmed: { label: "Confirmed", variant: "secondary", Icon: CalendarCheck },
  in_progress: { label: "In progress", variant: "default", Icon: Loader2, spin: true },
  completed: { label: "Completed", variant: "positive", Icon: CheckCircle2 },
};

/** Single descriptive status badge (replaces a generic pill + caption). */
export function BookingStatusBadge({ badge }: { badge: BookingBadgeKey }) {
  const c = BADGE[badge];
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}

const PAYMENT_VARIANT: Record<BookingPayment["tone"], BadgeProps["variant"]> = {
  paid: "positive",
  pending: "caution",
  failed: "critical",
  refunded: "info",
  selfpay: "info",
  none: "outline",
};

export function PaymentBadge({ payment }: { payment: BookingPayment | null }) {
  if (!payment) return null;
  return <Badge variant={PAYMENT_VARIANT[payment.tone]}>{payment.label}</Badge>;
}
