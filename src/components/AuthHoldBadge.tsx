import React from "react";
import { CreditCard, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

type AuthStatus =
  | "none"
  | "scheduled"
  | "authorizing"
  | "requires_action"
  | "authorized"
  | "captured"
  | "canceled"
  | "failed"
  | null
  | undefined;

interface Props {
  status: AuthStatus;
  className?: string;
}

/**
 * Compact card-hold (authorization) indicator for the new charge flow. Renders next to the
 * payment/status badges so an admin/manager can see at a glance whether the homeowner's card
 * is held, needs attention, or failed. Renders nothing for states that carry no signal
 * (none/scheduled/canceled) so the dense card layout stays uncluttered.
 */
export default function AuthHoldBadge({ status, className = "" }: Props) {
  const config = (() => {
    switch (status) {
      case "authorized":
        return { label: "Card held", cls: "bg-blue-50 text-blue-700", Icon: CreditCard };
      case "authorizing":
        return { label: "Authorizing", cls: "bg-gray-100 text-gray-600", Icon: Loader2, spin: true };
      case "requires_action":
        return { label: "Action needed", cls: "bg-amber-50 text-amber-700", Icon: AlertTriangle };
      case "failed":
        return { label: "Auth failed", cls: "bg-red-50 text-red-700", Icon: AlertTriangle };
      case "captured":
        return { label: "Captured", cls: "bg-green-50 text-green-700", Icon: CheckCircle2 };
      default:
        return null;
    }
  })();

  if (!config) return null;
  const { label, cls, Icon } = config;
  const spin = "spin" in config && config.spin;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${cls} ${className}`}
      title={`Card authorization: ${label}`}
    >
      <Icon className={`w-3 h-3 ${spin ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}
