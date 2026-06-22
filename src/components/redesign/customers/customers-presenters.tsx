import { CalendarCheck, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { CustomerHistoryStatus } from "./customers-types";

// Status badge for a customer's appointment-history row. Reuses the operator
// color hierarchy established on the Bookings screen: amber = pending (needs
// action), gray = confirmed (settled), blue = in progress (live, spinning),
// green = completed, red = cancelled.

type Config = {
  label: string;
  variant: BadgeProps["variant"];
  Icon: React.ComponentType<{ className?: string }>;
  /** Spin the icon (in progress = live work). Respects reduced-motion. */
  spin?: boolean;
};

const STATUS: Record<CustomerHistoryStatus, Config> = {
  pending: { label: "Pending", variant: "caution", Icon: Clock },
  confirmed: { label: "Confirmed", variant: "secondary", Icon: CalendarCheck },
  in_progress: { label: "In progress", variant: "default", Icon: Loader2, spin: true },
  completed: { label: "Completed", variant: "positive", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "critical", Icon: XCircle },
};

export function HistoryStatusBadge({ status }: { status: CustomerHistoryStatus }) {
  const c = STATUS[status] ?? STATUS.pending;
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon className={c.spin ? "motion-safe:animate-spin" : undefined} />
      {c.label}
    </Badge>
  );
}
