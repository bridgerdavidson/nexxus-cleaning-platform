import { Badge, type BadgeProps } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import type { BookingPayment, BookingStatusKey } from "./bookings-types";

// Shared presentational atoms so the desktop table and mobile cards render
// status + payment identically.

type PillStatus = "scheduled" | "in_progress" | "completed" | "cancelled" | "pending";

const STATUS_PILL: Record<BookingStatusKey, { status: PillStatus; label?: string }> = {
  pending: { status: "pending" },
  confirmed: { status: "scheduled", label: "Confirmed" },
  in_progress: { status: "in_progress" },
  completed: { status: "completed" },
  cancelled: { status: "cancelled" },
};

export function BookingStatusPill({
  status,
  label,
}: {
  status: BookingStatusKey;
  label?: string;
}) {
  const map = STATUS_PILL[status];
  return <StatusPill status={map.status} label={label ?? map.label} />;
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
