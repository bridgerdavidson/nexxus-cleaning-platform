import React from "react";
import { Calendar, MapPin, User, Briefcase, DollarSign, CheckSquare, Square, Repeat, X, Sparkles } from "lucide-react";
import StatusBadge from "./StatusBadge";

export interface AppointmentCardData {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  total_price: number;
  special_requests?: string | null;
  notes?: string | null;
  series_id?: string | null;
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
  homeowner_id?: string;
  homeowner?: {
    first_name: string;
    last_name: string;
    email?: string;
  } | null;
  cleaner_profile?: {
    user_profile?: {
      first_name: string;
      last_name: string;
    } | null;
  } | null;
  property?: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
  } | null;
  service_type?: {
    name: string;
    description?: string;
  } | null;
}

interface AppointmentCardProps {
  appointment: AppointmentCardData;
  onClick: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  role?: "admin" | "manager" | "cleaner" | "homeowner";
  canApproveDecline?: boolean;
}

export default function AppointmentCard({
  appointment,
  onClick,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  role,
  canApproveDecline = false,
}: AppointmentCardProps) {
  const formatDateTime = (date: string, time: string) => {
    // Parse date string (YYYY-MM-DD) as local date to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const localDate = new Date(year, month - 1, day); // month is 0-indexed
    const formattedDate = localDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    
    // Convert military time (HH:MM:SS) to 12-hour format with AM/PM
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12; // Convert 0 to 12 for midnight
    const formattedTime = `${displayHour}:${minutes} ${ampm}`;
    
    return { date: formattedDate, time: formattedTime };
  };

  const getHomeownerName = () => {
    if (appointment.homeowner) {
      const { first_name, last_name } = appointment.homeowner;
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const getCleanerName = () => {
    if (appointment.cleaner_profile?.user_profile) {
      const { first_name, last_name } = appointment.cleaner_profile.user_profile;
      return `${first_name} ${last_name}`;
    }
    return "Unassigned";
  };

  const getPropertyAddress = () => {
    if (appointment.property) {
      const { address, city, state } = appointment.property;
      if (address && city && state) {
        return `${address}, ${city}, ${state}`;
      }
    }
    return "Address not available";
  };

  const getPaymentStatusTabConfig = () => {
    const status = appointment.payment_status;
    switch (status) {
      case "paid":
        return {
          label: "Paid",
          bgColor: "bg-green-100",
          textColor: "text-green-700",
        };
      case "failed":
        return {
          label: "Failed",
          bgColor: "bg-red-100",
          textColor: "text-red-700",
        };
      case "pending":
        return {
          label: "Unpaid",
          bgColor: "bg-gray-100",
          textColor: "text-gray-700",
        };
      case "refunded":
        return {
          label: "Refunded",
          bgColor: "bg-blue-100",
          textColor: "text-blue-700",
        };
      case "unpaid":
      default:
        return {
          label: "Unpaid",
          bgColor: "bg-gray-100",
          textColor: "text-gray-700",
        };
    }
  };

  const { date, time } = formatDateTime(
    appointment.scheduled_date,
    appointment.scheduled_time
  );

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectMode && onToggleSelect) {
      onToggleSelect();
    } else if (!isSelectMode) {
      onClick();
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelect) {
      onToggleSelect();
    }
  };


  const paymentStatusConfig = getPaymentStatusTabConfig();

  return (
    <div
      onClick={handleCardClick}
      className={`relative bg-white border rounded-lg hover:shadow-lg transition-all duration-200 cursor-pointer group overflow-hidden ${
        isSelected
          ? "border-primary-500 bg-primary-50"
          : "border-gray-200 hover:border-primary-300"
      }`}
    >
      {/* Payment Status Tab - Hide for cleaner role */}
      {role !== "cleaner" && (
        <div
          className={`absolute right-0 top-0 bottom-0 ${paymentStatusConfig.bgColor} ${paymentStatusConfig.textColor} flex items-center justify-center px-3 w-20 border-l border-gray-200`}
        >
          <span className="font-semibold text-xs whitespace-nowrap">
            {paymentStatusConfig.label}
          </span>
        </div>
      )}
      {/* Recurring Icon - Positioned to the left of payment status tab */}
      {appointment.series_id && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 ${role === "cleaner" ? "right-0" : "right-[88px]"} z-10`}
          title="Recurring appointment"
        >
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium text-primary-700 bg-primary-100 rounded-full">
            <Repeat className="w-3 h-3" />
          </span>
        </div>
      )}
      <div className={`flex items-center gap-3 p-3 sm:p-4 lg:p-3 ${role === "cleaner" ? "" : "pr-24"}`}>
        {/* Checkbox (when in select mode) - Always on left */}
        {isSelectMode && (
          <div className="flex-shrink-0">
            <button
              onClick={handleCheckboxClick}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              {isSelected ? (
                <CheckSquare className="w-5 h-5 text-primary-600" />
              ) : (
                <Square className="w-5 h-5 text-gray-400" />
              )}
            </button>
          </div>
        )}

        {/* Desktop Layout (lg+): Horizontal compact */}
        <div className="hidden lg:grid lg:grid-cols-12 lg:gap-3 lg:items-center flex-1">
          {/* Date & Time */}
          <div className="col-span-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-primary-600 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-900 truncate">{date}</p>
            <p className="text-xs text-gray-600">{time}</p>
          </div>
        </div>

        {/* Property & Service */}
        <div className="col-span-3 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <p className="text-sm text-gray-900 truncate font-medium">{getPropertyAddress()}</p>
          </div>
          {appointment.service_type && (
            <div className="flex items-center gap-1.5">
              <Briefcase className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <p className="text-xs text-gray-600 truncate">
                {appointment.service_type.name}
              </p>
            </div>
          )}
        </div>

        {/* Homeowner */}
        <div className={`${role === "cleaner" ? "col-span-4" : "col-span-2"} flex items-center gap-1.5 min-w-0`}>
          <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <p className="font-medium text-sm text-gray-900 truncate">{getHomeownerName()}</p>
        </div>

        {/* Cleaner - Hide for cleaner role */}
        {role !== "cleaner" && (
          <div className="col-span-2 flex items-center gap-1.5 min-w-0">
            <Sparkles className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <p className={`font-medium text-sm truncate ${getCleanerName() === "Unassigned" ? "text-gray-400 italic" : "text-gray-900"}`}>
              {getCleanerName()}
            </p>
          </div>
        )}

        {/* Status */}
        <div className="col-span-2 flex items-center justify-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1.5">
            <StatusBadge status={appointment.status} size="sm" />
          </div>
          {((role === "admin" || (role === "manager" && canApproveDecline)) && appointment.status === "pending") && (
            <div className="ml-2 flex items-center gap-1.5">
              <button
                className="px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200 transition-colors"
                title="Review appointment"
              >
                Review
              </button>
            </div>
          )}
        </div>

        {/* Price */}
        <div className="col-span-1 flex items-center justify-end">
          <span className="text-base font-bold text-gray-900">
            ${appointment.total_price.toFixed(0)}
          </span>
        </div>
      </div>

      {/* Tablet & Mobile Layout: Vertical cards */}
      <div className={`p-3 sm:p-4 ${role === "cleaner" ? "" : "pr-24"} lg:hidden`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Booking Info */}
          <div className="sm:col-span-2 space-y-2">
            <div className="flex items-start gap-2">
              <Calendar className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-gray-900">{date}</p>
              <p className="text-sm text-gray-600">{time}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-gray-600">{getPropertyAddress()}</p>
          </div>
          {appointment.service_type && (
            <div className="flex items-start gap-2">
              <Briefcase className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-600">
                {appointment.service_type.name}
              </p>
            </div>
          )}
        </div>

        {/* Homeowner */}
        <div className="flex items-start gap-2">
          <User className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              Homeowner
            </p>
            <p className="font-medium text-gray-900">{getHomeownerName()}</p>
          </div>
        </div>

        {/* Cleaner - Hide for cleaner role */}
        {role !== "cleaner" && (
          <div className="flex items-start gap-2">
            <Sparkles className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Cleaner
              </p>
              <p className={`font-medium ${getCleanerName() === "Unassigned" ? "text-gray-400 italic" : "text-gray-900"}`}>
                {getCleanerName()}
              </p>
            </div>
          </div>
        )}

        {/* Status and Price */}
        <div className="sm:col-span-2 flex sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={appointment.status} size="md" />
            {((role === "admin" || (role === "manager" && canApproveDecline)) && appointment.status === "pending") && (
              <div className="flex items-center gap-1.5">
                <button
                  className="px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200 transition-colors"
                  title="Review appointment"
                >
                  Review
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 text-right">
            <DollarSign className="w-5 h-5 text-green-600" />
            <span className="text-lg font-bold text-gray-900">
              {appointment.total_price.toFixed(2)}
            </span>
          </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

