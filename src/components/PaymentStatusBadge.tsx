"use client";

import React from "react";
import { CheckCircle, Clock, AlertCircle, CreditCard } from "lucide-react";
import type { PaymentStatus } from "../types";

interface PaymentStatusBadgeProps {
  status: PaymentStatus | "unpaid" | null;
  size?: "sm" | "md";
  showIcon?: boolean;
}

export default function PaymentStatusBadge({
  status,
  size = "sm",
  showIcon = true,
}: PaymentStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "paid":
        return {
          label: "Paid",
          bgColor: "bg-green-100",
          textColor: "text-green-700",
          borderColor: "border-green-200",
          icon: CheckCircle,
        };
      case "failed":
        return {
          label: "Failed",
          bgColor: "bg-red-100",
          textColor: "text-red-700",
          borderColor: "border-red-200",
          icon: AlertCircle,
        };
      case "pending":
        return {
          label: "Unpaid",
          bgColor: "bg-yellow-100",
          textColor: "text-yellow-700",
          borderColor: "border-yellow-200",
          icon: Clock,
        };
      case "refunded":
        return {
          label: "Refunded",
          bgColor: "bg-gray-100",
          textColor: "text-gray-700",
          borderColor: "border-gray-200",
          icon: CreditCard,
        };
      case "unpaid":
      default:
        return {
          label: "Unpaid",
          bgColor: "bg-yellow-100",
          textColor: "text-yellow-700",
          borderColor: "border-yellow-200",
          icon: Clock,
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const sizeClasses = size === "sm" 
    ? "px-2 py-0.5 text-xs" 
    : "px-2.5 py-1 text-sm";

  const iconSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-full border ${config.bgColor} ${config.textColor} ${config.borderColor} ${sizeClasses}`}
    >
      {showIcon && <Icon className={iconSize} />}
      {config.label}
    </span>
  );
}

// Standalone component for appointment cards that fetches payment status
interface AppointmentPaymentStatusProps {
  appointmentId: string;
  paymentStatus?: PaymentStatus | null;
  size?: "sm" | "md";
}

export function AppointmentPaymentStatus({
  appointmentId,
  paymentStatus,
  size = "sm",
}: AppointmentPaymentStatusProps) {
  // If payment status is provided directly, use it
  // Otherwise, assume unpaid (no payment record exists)
  const status = paymentStatus || "unpaid";

  return <PaymentStatusBadge status={status} size={size} />;
}

