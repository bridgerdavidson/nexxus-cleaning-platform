import React from "react";
import {
  Clock,
  CheckCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md" | "lg";
  /**
   * Cleaner-confirmation state for the appointment, if any. When set to
   * "rejected" it overrides the underlying status with a "Reschedule
   * Required" badge. Other values defer to the regular status mapping.
   */
  cleanerConfirmationStatus?: "awaiting" | "approved" | "rejected" | null;
}

export default function StatusBadge({
  status,
  size = "md",
  cleanerConfirmationStatus,
}: StatusBadgeProps) {
  const getStatusConfig = () => {
    if (cleanerConfirmationStatus === "rejected") {
      return {
        bgColor: "bg-orange-50",
        textColor: "text-orange-700",
        icon: RefreshCw,
        label: "Reschedule Required",
      };
    }

    switch (status.toLowerCase()) {
      case "pending":
        return {
          bgColor: "bg-amber-50",
          textColor: "text-amber-700",
          icon: Clock,
          label: "Awaiting Cleaner",
        };
      case "confirmed":
        return {
          bgColor: "bg-blue-50",
          textColor: "text-blue-700",
          icon: CheckCircle,
          label: "Confirmed",
        };
      case "in_progress":
        return {
          bgColor: "bg-cyan-50",
          textColor: "text-cyan-700",
          icon: Loader2,
          label: "In Progress",
        };
      case "completed":
        return {
          bgColor: "bg-emerald-50",
          textColor: "text-emerald-700",
          icon: CheckCircle2,
          label: "Completed",
        };
      case "cancelled":
        return {
          bgColor: "bg-slate-100",
          textColor: "text-slate-600",
          icon: XCircle,
          label: "Cancelled",
        };
      default:
        return {
          bgColor: "bg-gray-100",
          textColor: "text-gray-700",
          icon: Clock,
          label: status,
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${config.bgColor} ${config.textColor} ${sizeClasses[size]}`}
    >
      <Icon
        className={`${iconSizes[size]} ${
          status.toLowerCase() === "in_progress" ? "animate-spin" : ""
        }`}
      />
      {config.label}
    </span>
  );
}
