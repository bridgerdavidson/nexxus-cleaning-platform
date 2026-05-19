import React from "react";
import {
  Clock,
  CheckCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Calendar,
} from "lucide-react";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md" | "lg";
  /**
   * Cleaner-confirmation state for the appointment, if any. When set to
   * `"rejected"`, the badge collapses to either "Counter-proposed" (if the
   * cleaner has provided suggested alternative times) or "Pending" (hard
   * decline — appointment falls back into the admin's pending queue).
   */
  cleanerConfirmationStatus?: "awaiting" | "approved" | "rejected" | null;
  /**
   * True when the appointment has cleaner-suggested alternative times. Used
   * with `cleanerConfirmationStatus === "rejected"` to render the
   * "Counter-proposed" bucket instead of "Pending".
   */
  hasSuggestedTimes?: boolean;
}

export default function StatusBadge({
  status,
  size = "md",
  cleanerConfirmationStatus,
  hasSuggestedTimes = false,
}: StatusBadgeProps) {
  const getStatusConfig = () => {
    // Wave 1: 5 user-visible buckets uniformly across roles:
    //  Pending / Counter-proposed / Confirmed / In progress / Done.
    // `cancelled` is rendered but not part of the 5 "live" buckets.
    if (cleanerConfirmationStatus === "rejected") {
      if (hasSuggestedTimes) {
        return {
          bgColor: "bg-orange-50",
          textColor: "text-orange-700",
          icon: Calendar,
          label: "Counter-proposed",
        };
      }
      // Hard decline falls back into the admin's pending queue.
      return {
        bgColor: "bg-amber-50",
        textColor: "text-amber-700",
        icon: Clock,
        label: "Pending",
      };
    }

    switch (status.toLowerCase()) {
      case "pending":
        return {
          bgColor: "bg-amber-50",
          textColor: "text-amber-700",
          icon: Clock,
          label: "Pending",
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
          label: "In progress",
        };
      case "completed":
        return {
          bgColor: "bg-emerald-50",
          textColor: "text-emerald-700",
          icon: CheckCircle2,
          label: "Done",
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
