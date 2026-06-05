"use client";

import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { formatTimeTo12h } from "../lib/formatTime";
import { useAuth } from "../hooks/useAuth";
import ConfirmAvailabilityModal, { type ConfirmModalMode } from "./ConfirmAvailabilityModal";
import { deriveFreeSlots, type ScheduleConflictBlock } from "../lib/cleanerFreeSlots";
import {
  deadlineUrgency,
  type DeadlineUrgency,
} from "../lib/isAppointmentOverdue";
import type { DeclineReason } from "../types";

interface OfferedSlot {
  slot_index: number;
  scheduled_date: string;
  scheduled_time: string;
}

interface PendingAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  /** Wave 2 SLA: deadline by which the cleaner must respond. */
  response_deadline?: string | null;
  cleaner_confirmation_status?: "awaiting" | "approved" | "rejected" | null;
  /** Org self-pay appointments have no homeowner; the org is the client. */
  is_self_pay?: boolean;
  homeowner?: {
    first_name: string | null;
    last_name: string | null;
  };
  property?: {
    address: string;
    city: string;
    state: string;
    zip_code?: string;
  };
  service_type?: {
    name: string;
  };
  checklist?: {
    name: string;
  };
  homeowner_initiated?: boolean;
  requested_slots?: OfferedSlot[];
}

interface PendingConfirmationsSectionProps {
  appointments: PendingAppointment[];
  loading: boolean;
  userId: string;
  organizationId: string;
  /** Existing schedule blocks used to derive same-time-of-day free-slot candidates. */
  cleanerSchedule?: ScheduleConflictBlock[];
  /** Auth token for /api/appointments/confirm — required by requireOrgAuth. */
  accessToken?: string | null;
  onConfirmed: () => void;
}

function getHomeownerName(apt: PendingAppointment, orgName?: string | null) {
  if (apt.homeowner) {
    const { first_name, last_name } = apt.homeowner;
    const name = `${first_name || ""} ${last_name || ""}`.trim();
    if (name) return name;
  }
  // Self-pay appointments have no homeowner; show the organization as the client
  // so the card reads like a normal booking (matches AppointmentCard / SidePanel).
  if (apt.is_self_pay) return orgName || "Company";
  return "Unknown";
}

function getPropertyAddress(apt: PendingAppointment) {
  if (apt.property) {
    const { address, city, state } = apt.property;
    return `${address}, ${city}, ${state}`;
  }
  return "Address not available";
}

function getServiceName(apt: PendingAppointment) {
  if (!apt.service_type) return "Cleaning Service";
  return apt.checklist?.name
    ? `${apt.service_type.name} (${apt.checklist.name})`
    : apt.service_type.name;
}

function formatChipDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Build the canonical slot list. Falls back to a single synthetic slot for
 *  legacy admin-direct appointments that have no `appointment_requested_slots`
 *  rows. */
function getOfferedSlots(apt: PendingAppointment): OfferedSlot[] {
  if (apt.requested_slots && apt.requested_slots.length > 0) {
    return [...apt.requested_slots].sort((a, b) => a.slot_index - b.slot_index);
  }
  return [
    {
      slot_index: 0,
      scheduled_date: apt.scheduled_date,
      scheduled_time: apt.scheduled_time,
    },
  ];
}

export default function PendingConfirmationsSection({
  appointments,
  loading,
  organizationId,
  cleanerSchedule = [],
  accessToken,
  onConfirmed,
}: PendingConfirmationsSectionProps) {
  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) h.Authorization = `Bearer ${accessToken}`;
    return h;
  };
  const [expanded, setExpanded] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ConfirmModalMode>("confirm");
  const [selectedAppointment, setSelectedAppointment] =
    useState<PendingAppointment | null>(null);

  // Derive free-slot chips for the selected appointment whenever it changes
  // or the cleaner's schedule does.
  const freeSlotCandidates = useMemo(() => {
    if (!selectedAppointment) return [];
    return deriveFreeSlots(
      cleanerSchedule.filter((b) => b.date !== selectedAppointment.scheduled_date),
      {
        date: selectedAppointment.scheduled_date,
        time: selectedAppointment.scheduled_time,
      },
      { count: 5 },
    );
  }, [selectedAppointment, cleanerSchedule]);

  if (loading || appointments.length === 0) return null;

  const openModal = (apt: PendingAppointment, mode: ConfirmModalMode) => {
    setSelectedAppointment(apt);
    setModalMode(mode);
    setModalOpen(true);
  };

  /** Short-circuit accept from the card — slot was picked inline. */
  const acceptSlot = async (apt: PendingAppointment, slotIndex: number) => {
    const body: Record<string, unknown> = {
      appointmentId: apt.id,
      action: "accept",
      organizationId,
      slotIndex,
    };
    const response = await fetch("/api/appointments/confirm", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to confirm appointment");
    }
    onConfirmed();
  };

  // Handlers below are used by the modal for decline / counter-propose flows.
  const handleConfirm = async (slotIndex: number | null) => {
    if (!selectedAppointment) return;
    const body: Record<string, unknown> = {
      appointmentId: selectedAppointment.id,
      action: "accept",
      organizationId,
    };
    if (slotIndex !== null) body.slotIndex = slotIndex;
    const response = await fetch("/api/appointments/confirm", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to confirm appointment");
    }
    onConfirmed();
  };

  const handlePropose = async (
    reason: string,
    suggestedTimes: { date: string; time: string }[],
    suggestedWindows: { date: string; startTime: string; endTime: string }[],
  ) => {
    if (!selectedAppointment) return;
    const response = await fetch("/api/appointments/confirm", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        appointmentId: selectedAppointment.id,
        action: "counter_propose",
        organizationId,
        feedback: {
          reason,
          suggestedTimes: suggestedTimes.filter((st) => st.date && st.time),
          suggestedWindows: suggestedWindows.filter(
            (sw) => sw.date && sw.startTime && sw.endTime,
          ),
        },
      }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to submit proposal");
    }
    onConfirmed();
  };

  const handleDecline = async (reason: DeclineReason, other: string) => {
    if (!selectedAppointment) return;
    const response = await fetch("/api/appointments/confirm", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        appointmentId: selectedAppointment.id,
        action: "decline",
        organizationId,
        declineReason: reason,
        declineReasonOther: other,
      }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to submit decline");
    }
    onConfirmed();
  };

  const modalAppointmentInfo = selectedAppointment
    ? {
        id: selectedAppointment.id,
        scheduled_date: selectedAppointment.scheduled_date,
        scheduled_time: selectedAppointment.scheduled_time,
        homeowner_name: getHomeownerName(selectedAppointment),
        property_address: getPropertyAddress(selectedAppointment),
        service_name: getServiceName(selectedAppointment),
      }
    : null;

  return (
    <>
      <div className="relative">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 rounded-2xl opacity-75 motion-safe:animate-pulse" />

        <section className="relative bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full bg-gradient-to-r from-amber-50 to-orange-50 px-4 sm:px-5 py-4 flex items-center justify-between hover:from-amber-100 hover:to-orange-100 transition-colors duration-200 group"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="p-2 bg-amber-100 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                </div>
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                </span>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-gray-900">Action Required</h3>
                <p className="text-xs font-medium text-amber-700">
                  Pick a time and confirm your availability
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-amber-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {appointments.length}
              </span>
              <div className="p-2 bg-white/70 rounded-full group-hover:bg-white transition-colors duration-200">
                {expanded ? (
                  <ChevronDown className="w-5 h-5 text-amber-700" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-amber-700" />
                )}
              </div>
            </div>
          </button>

          {expanded && (
            <div className="border-t border-amber-100 bg-amber-50/40 p-3 sm:p-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                  <span className="ml-2 text-gray-600">Loading...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {appointments.map((apt) => (
                    <PendingConfirmationCard
                      key={apt.id}
                      appointment={apt}
                      onAccept={(slotIndex) => acceptSlot(apt, slotIndex)}
                      onDeclineClick={() => openModal(apt, "decline")}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <ConfirmAvailabilityModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedAppointment(null);
        }}
        onConfirm={handleConfirm}
        onPropose={handlePropose}
        onDecline={handleDecline}
        appointment={modalAppointmentInfo}
        mode={modalMode}
        freeSlotCandidates={freeSlotCandidates}
        homeownerInitiated={!!selectedAppointment?.homeowner_initiated}
        offeredSlots={selectedAppointment?.requested_slots ?? []}
      />
    </>
  );
}

interface PendingConfirmationCardProps {
  appointment: PendingAppointment;
  onAccept: (slotIndex: number) => Promise<void>;
  onDeclineClick: () => void;
}

function PendingConfirmationCard({
  appointment: apt,
  onAccept,
  onDeclineClick,
}: PendingConfirmationCardProps) {
  const { currentOrganization } = useAuth();
  const slots = useMemo(() => getOfferedSlots(apt), [apt]);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(
    slots.length === 1 ? slots[0].slot_index : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (selectedSlotIndex === null) return;
    try {
      setSubmitting(true);
      setError(null);
      await onAccept(selectedSlotIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      {/* Top row: identity + SLA badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">
            {getHomeownerName(apt, currentOrganization?.name)}
          </p>
          <p className="text-sm text-gray-500 truncate">{getServiceName(apt)}</p>
          <p className="text-sm text-gray-500 truncate">{getPropertyAddress(apt)}</p>
        </div>
        <DeadlineBadge deadline={apt.response_deadline} />
      </div>

      {/* Slot chips — inline row that wraps on narrow widths, radio-style selection */}
      <div
        className="flex flex-wrap gap-2 mb-3 w-full"
        role="radiogroup"
        aria-label="Available times"
      >
        {slots.map((s) => {
          const isSelected = selectedSlotIndex === s.slot_index;
          const isPrimary = s.slot_index === 0;
          return (
            <button
              key={s.slot_index}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelectedSlotIndex(s.slot_index)}
              className={[
                "flex-1 basis-[180px] min-w-[160px] min-h-[48px] flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-medium bg-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
                isSelected
                  ? "border-2 border-primary-500"
                  : "border-2 border-gray-200 hover:border-primary-300",
              ].join(" ")}
            >
              {/* Radio indicator */}
              <span
                className={[
                  "flex items-center justify-center w-5 h-5 rounded-full border-2 flex-shrink-0 transition-colors",
                  isSelected ? "border-primary-500" : "border-gray-300",
                ].join(" ")}
                aria-hidden="true"
              >
                {isSelected && (
                  <span className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                )}
              </span>

              {/* Date + time */}
              <span className="flex-1 text-left text-gray-800 truncate">
                {formatChipDate(s.scheduled_date)}
                <span className="text-gray-400 mx-1">·</span>
                {formatTimeTo12h(s.scheduled_time)}
              </span>

              {/* Primary badge — only when slots offer alternatives */}
              {isPrimary && slots.length > 1 && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 flex-shrink-0">
                  Primary
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2" role="alert">
          {error}
        </p>
      )}

      {/* Action row: Accept (gated on chip) / Decline (always live) */}
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={handleAccept}
          disabled={selectedSlotIndex === null || submitting}
          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-3 py-2.5 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition-colors duration-200 font-medium text-sm focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          {selectedSlotIndex === null && slots.length > 1 ? "Pick a time to accept" : "Accept"}
        </button>
        <button
          onClick={onDeclineClick}
          disabled={submitting}
          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-3 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors duration-200 font-medium text-sm focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
        >
          <XCircle className="w-4 h-4" />
          Decline
        </button>
      </div>
    </div>
  );
}

// Re-render every minute so the countdown stays fresh without flooding the
// component with refs. Keeping the badge as its own tiny component scopes the
// state to the rows that need it.
const BADGE_STYLES: Record<DeadlineUrgency, string> = {
  plenty: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  soon: "bg-amber-50 text-amber-700 border border-amber-200",
  urgent: "bg-red-50 text-red-700 border border-red-200",
  overdue: "bg-red-600 text-white border border-red-700",
};

function DeadlineBadge({ deadline }: { deadline: string | null | undefined }) {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    if (!deadline) return;
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60 * 1000); // 1 min cadence
    return () => window.clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;
  const urgency = deadlineUrgency(
    {
      cleaner_confirmation_status: "awaiting",
      response_deadline: deadline,
    },
    null,
    now,
  );
  if (!urgency) return null;

  const deadlineMs = Date.parse(deadline);
  const remainingMs = deadlineMs - now.getTime();
  const label = formatRemaining(remainingMs);

  return (
    <span
      className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE_STYLES[urgency]}`}
      role="status"
      aria-live="polite"
      title={`Respond by ${new Date(deadlineMs).toLocaleString()}`}
    >
      <Clock className="w-3 h-3" />
      {label}
    </span>
  );
}

function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return "Overdue";
  const totalMin = Math.floor(remainingMs / (60 * 1000));
  if (totalMin < 60) return `${totalMin}m left`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) {
    return mins === 0 ? `${hours}h left` : `${hours}h ${mins}m left`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}
