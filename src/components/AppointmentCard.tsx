import React, { useState } from "react";
import { Calendar, MapPin, User, Briefcase, DollarSign, CheckSquare, Square, Repeat, X, Sparkles, AlertCircle, Clock, RefreshCw, Play } from "lucide-react";
import StatusBadge from "./StatusBadge";
import CompactAppointmentRow from "./CompactAppointmentRow";
import { formatTimeTo12h } from "../lib/formatTime";
import {
  DASHBOARD_HERO_SECONDARY_BUTTON_CLASS,
  DASHBOARD_HERO_SECONDARY_BUTTON_STYLE,
} from "../lib/dashboardHero";
import CompactJobProgressIndicator from "./CompactJobProgressIndicator";
import { JobProgress } from "../types";

export interface AppointmentCardData {
  id: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  job_progress?: string;
  total_price: number;
  special_requests?: string | null;
  notes?: string | null;
  series_id?: string | null;
  cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected';
  price_override_enabled?: boolean;
  price_override_total?: number | null;
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
  checklist?: {
    name: string;
    price_adder?: number;
  } | null;
  /**
   * Optional org id. Required by the Bookings page's "Needs your response"
   * section so the admin's accept-counter-proposal API call has the org
   * scope; threaded through from `AdminAppointment.organization_id`.
   */
  organization_id?: string | null;
  /**
   * Wave 2 SLA: cleaner-response deadline. Null once the cleaner responds.
   * BookingsPage uses `isAppointmentOverdue` against this + status +
   * cleaner_confirmation_status to compute the overdue surface.
   */
  response_deadline?: string | null;
  /**
   * Latest cleaner-availability feedback for the appointment (joined). When
   * `cleaner_suggested_times` rows exist on this feedback, the row is a
   * counter-proposal that the admin can one-click accept. When only `reason`
   * is set, it's a hard decline.
   */
  cleaner_availability_feedback?: Array<{
    id: string;
    reason: string | null;
    cleaner_suggested_times?: Array<{
      id: string;
      suggested_date: string;
      suggested_time: string;
    }> | null;
    cleaner_suggested_windows?: Array<{
      id: string;
      window_date: string;
      start_time: string;
      end_time: string;
    }> | null;
  }> | null;
}

interface AppointmentCardProps {
  appointment: AppointmentCardData;
  onClick: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  role?: "admin" | "manager" | "cleaner" | "homeowner";
  canApproveDecline?: boolean;
  onStartJob?: (appointmentId: string) => void;
}

export default function AppointmentCard({
  appointment,
  onClick,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  role,
  canApproveDecline = false,
  onStartJob,
}: AppointmentCardProps) {
  const [isStarting, setIsStarting] = useState(false);

  const formatDateTime = (date: string, time: string) => {
    const [year, month, day] = date.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    const formattedDate = localDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return { date: formattedDate, time: formatTimeTo12h(time) };
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

  const getServiceLabel = () => {
    if (!appointment.service_type?.name) return "Service";
    const checklistName = appointment.checklist?.name;
    return checklistName
      ? `${appointment.service_type.name} (${checklistName})`
      : appointment.service_type.name;
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

  const handleStartJobClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onStartJob && !isStarting) {
      setIsStarting(true);
      try {
        await onStartJob(appointment.id);
      } finally {
        // Component may unmount when parent switches tabs, so this finally may not run
        // but that's okay - the loading state is just for UI feedback
        setIsStarting(false);
      }
    }
  };

  const showStartJobButton = 
    role === "cleaner" && 
    onStartJob && 
    appointment.status === "confirmed";


  const paymentStatusConfig = getPaymentStatusTabConfig();

  // Unified compact row on mobile for admin/manager/homeowner. The cluttered
  // legacy mobile layout (date pill + status stack + indented address + footer
  // row) is preserved only for the cleaner role, where the Start Job action
  // and on-shift workflow live.
  const renderMobileCompactRow = role !== "cleaner";

  return (
    <>
      {renderMobileCompactRow && (
        <div className="lg:hidden">
          {isSelectMode ? (
            <div
              className={`flex items-stretch gap-2 ${
                isSelected ? "rounded-xl ring-2 ring-primary-400" : ""
              }`}
            >
              <button
                onClick={handleCheckboxClick}
                className="flex-shrink-0 self-stretch px-2 flex items-center bg-white rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                aria-label={isSelected ? "Deselect" : "Select"}
              >
                {isSelected ? (
                  <CheckSquare className="w-5 h-5 text-primary-600" />
                ) : (
                  <Square className="w-5 h-5 text-gray-400" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <CompactAppointmentRow
                  appointment={appointment}
                  onClick={onToggleSelect}
                />
              </div>
            </div>
          ) : (
            <CompactAppointmentRow
              appointment={appointment}
              onClick={onClick}
            />
          )}
        </div>
      )}
    <div
      onClick={handleCardClick}
      className={`relative bg-white border rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group overflow-hidden ${
        renderMobileCompactRow ? "hidden lg:block" : ""
      } ${
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
            <div className="flex items-center gap-1.5 min-w-0">
              <Briefcase className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <p className="text-xs text-gray-600 truncate">
                {getServiceLabel()}
              </p>
            </div>
          )}
        </div>

        {/* Homeowner */}
        <div className={`${role === "cleaner" ? (showStartJobButton ? "col-span-2" : "col-span-5") : "col-span-2"} flex items-center gap-1.5 min-w-0`}>
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

        {/* Status with inline progress - hide progress bar for cleaner role */}
        {/* For cleaner with button, expand status section to col-span-5 to push button far right */}
        <div className={`${role === "cleaner" && showStartJobButton ? "col-span-5" : "col-span-2"} flex items-center ${role === "cleaner" && showStartJobButton ? "justify-between" : "justify-center flex-col"} gap-2`}>
          <div className="flex items-center gap-2">
            {appointment.cleaner_confirmation_status === 'rejected' && role !== "cleaner" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-orange-50 text-orange-700 rounded-full">
                <RefreshCw className="w-3 h-3" />
                Reschedule Required
              </span>
            ) : appointment.cleaner_confirmation_status === 'awaiting' && role !== "cleaner" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full">
                <Clock className="w-3 h-3" />
                Awaiting Cleaner
              </span>
            ) : (
              <div className="flex items-center gap-2">
                {role !== "cleaner" && appointment.status === "in_progress" && appointment.job_progress && (
                  <CompactJobProgressIndicator 
                    currentProgress={appointment.job_progress as JobProgress} 
                  />
                )}
                <StatusBadge status={appointment.status} size="sm" />
              </div>
            )}
          </div>
          {showStartJobButton && (
            <button
              onClick={handleStartJobClick}
              disabled={isStarting}
              className={`flex flex-shrink-0 items-center gap-2 ${DASHBOARD_HERO_SECONDARY_BUTTON_CLASS}`}
              style={DASHBOARD_HERO_SECONDARY_BUTTON_STYLE}
              title="Start this job"
            >
              <Play className="h-4 w-4 shrink-0 text-primary-700" />
              {isStarting ? "Starting..." : "Start Job"}
            </button>
          )}
        </div>

        {/* Price - Hide for cleaner role */}
        {role !== "cleaner" && (
          <div className="col-span-1 flex items-center justify-end">
            <span className="text-base font-bold text-gray-900">
              ${appointment.total_price.toFixed(0)}
            </span>
          </div>
        )}
      </div>
      </div>

      {/* Tablet & Mobile Layout: Phone-first layout */}
      <div className={`p-4 ${role === "cleaner" ? "" : "pr-[4.5rem]"} lg:hidden flex flex-col gap-3.5`}>
        {/* Top row: Date/Time + Status/Actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center text-primary-600">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold tracking-tight text-gray-900">{date}</p>
              <p className="text-xs font-medium text-gray-500">{time}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {appointment.cleaner_confirmation_status === 'rejected' && role !== "cleaner" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-orange-50 text-orange-700 rounded-full">
                Reschedule
              </span>
            ) : appointment.cleaner_confirmation_status === 'awaiting' && role !== "cleaner" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 rounded-full">
                Awaiting
              </span>
            ) : (
              <div className="flex items-center gap-2">
                {role !== "cleaner" && appointment.status === "in_progress" && appointment.job_progress && (
                  <CompactJobProgressIndicator currentProgress={appointment.job_progress as JobProgress} />
                )}
                <StatusBadge status={appointment.status} size="sm" />
              </div>
            )}
          </div>
        </div>

        {/* Middle row: Address & Service */}
        <div className="flex flex-col gap-2 pl-[42px]">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium text-gray-700">{getPropertyAddress()}</p>
          </div>
          {appointment.service_type && (
            <div className="flex items-start gap-2">
              <Briefcase className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-600">{getServiceLabel()}</p>
            </div>
          )}
        </div>

        {/* Bottom row: People & Money */}
        <div className="flex items-center justify-between gap-4 pl-[42px] pt-2 border-t border-gray-100">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Client</span>
              <span className="text-xs font-medium text-gray-900">{getHomeownerName()}</span>
            </div>
            {role !== "cleaner" && (
              <div className="flex flex-col pl-4 border-l border-gray-100">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Cleaner</span>
                <span className={`text-xs font-medium ${getCleanerName() === "Unassigned" ? "text-gray-400 italic" : "text-gray-900"}`}>
                  {getCleanerName()}
                </span>
              </div>
            )}
          </div>
          {role !== "cleaner" && (
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Total</span>
              <span className="text-sm font-bold text-gray-900">${appointment.total_price.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Primary Action Row - Full width button on mobile */}
        {showStartJobButton && (
          <div className="mt-2 pt-3 border-t border-gray-100">
            <button
              onClick={handleStartJobClick}
              disabled={isStarting}
              className={`flex w-full items-center justify-center gap-2 ${DASHBOARD_HERO_SECONDARY_BUTTON_CLASS}`}
              style={DASHBOARD_HERO_SECONDARY_BUTTON_STYLE}
            >
              <Play className="h-4 w-4 shrink-0 text-primary-700" />
              {isStarting ? "Starting Job..." : "Start Job"}
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

