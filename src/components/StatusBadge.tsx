import React from "react";
import { Clock, CheckCircle, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md" | "lg";
}

export default function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status.toLowerCase()) {
      case "pending":
        return {
          bgColor: "bg-yellow-100",
          textColor: "text-yellow-700",
          icon: Clock,
          label: "Pending",
        };
      case "confirmed":
        return {
          bgColor: "bg-blue-100",
          textColor: "text-blue-700",
          icon: CheckCircle,
          label: "Confirmed",
        };
      case "in_progress":
        return {
          bgColor: "bg-purple-100",
          textColor: "text-purple-700",
          icon: Loader2,
          label: "In Progress",
        };
      case "completed":
        return {
          bgColor: "bg-green-100",
          textColor: "text-green-700",
          icon: CheckCircle2,
          label: "Completed",
        };
      case "cancelled":
        return {
          bgColor: "bg-red-100",
          textColor: "text-red-700",
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

  const config = getStatusConfig(status);
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
      <Icon className={`${iconSizes[size]} ${status.toLowerCase() === "in_progress" ? "animate-spin" : ""}`} />
      {config.label}
    </span>
  );
}

