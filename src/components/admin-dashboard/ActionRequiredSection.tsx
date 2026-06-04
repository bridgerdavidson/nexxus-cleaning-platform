"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Hourglass,
  Loader2,
  MapPin,
  RefreshCw,
  UserCheck,
} from "lucide-react";
import {
  useAdminActionItems,
  type AdminActionItem,
} from "../../hooks/useAdminActionItems";
import {
  actionReasonLabel,
  type ActionReason,
} from "../../lib/appointments/actionReason";
import { formatDateTimeTo12h, formatTimeTo12h } from "../../lib/formatTime";
import { routingDeclineReasonLabel } from "../../types";
import AssignCleanerModal from "../AssignCleanerModal";

interface ActionRequiredSectionProps {
  /** Optional click handler to drill into appointment detail. */
  onAppointmentClick?: (item: AdminActionItem) => void;
  /**
   * Called when the admin needs to reassign a cleaner (rejected/overdue
   * flows). Receives the appointment so the caller can open its existing
   * RescheduleAppointmentModal.
   */
  onReassign?: (item: AdminActionItem) => void;
  /** Defaults to true. Set to false to start collapsed on mobile. */
  defaultExpanded?: boolean;
  /**
   * Notification deep-link: when set to an appointment id present in this queue,
   * auto-open the cleaner-assignment modal for it (force mode for a fully
   * declined chain). Cleared via `onAssignHandled` once consumed.
   */
  assignAppointmentId?: string | null;
  onAssignHandled?: () => void;
}

interface GroupHeaderProps {
  reason: ActionReason;
  count: number;
}

function groupAccent(reason: ActionReason): { dot: string; chip: string; chipText: string } {
  switch (reason) {
    case "counter_proposed":
      return { dot: "bg-blue-500", chip: "bg-blue-50", chipText: "text-blue-700" };
    case "all_cleaners_declined":
      return { dot: "bg-red-500", chip: "bg-red-50", chipText: "text-red-700" };
    case "cleaner_overdue":
      return { dot: "bg-red-500", chip: "bg-red-50", chipText: "text-red-700" };
    case "cleaner_declined":
      return { dot: "bg-amber-500", chip: "bg-amber-50", chipText: "text-amber-700" };
    case "awaiting_assignment":
      return { dot: "bg-primary-500", chip: "bg-primary-50", chipText: "text-primary-700" };
  }
}

function GroupHeader({ reason, count }: GroupHeaderProps) {
  const accent = groupAccent(reason);
  return (
    <div className="flex items-center gap-2 mb-2 mt-1 first:mt-0">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${accent.dot}`} />
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
        {actionReasonLabel(reason)}
      </h4>
      <span
        className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[10px] font-semibold rounded-full ${accent.chip} ${accent.chipText}`}
      >
        {count}
      </span>
    </div>
  );
}

function customerName(item: AdminActionItem): string {
  const ho = item.homeowner;
  if (!ho) return "Customer";
  const name = `${ho.first_name ?? ""} ${ho.last_name ?? ""}`.trim();
  return name || ho.email || "Customer";
}

function cleanerNameFor(item: AdminActionItem): string {
  const cp = item.current_cleaner?.user_profile;
  if (!cp) return "The cleaner";
  return `${cp.first_name ?? ""} ${cp.last_name ?? ""}`.trim() || "The cleaner";
}

interface AwaitingAssignmentRowProps {
  item: AdminActionItem;
  onAssign: () => void;
}

function AwaitingAssignmentRow({ item, onAssign }: AwaitingAssignmentRowProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const finishedAttempts = item.routing_log.filter((l) => l.response !== "pending");

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-900 truncate">
              {customerName(item)}
            </span>
            {item.reason === "all_cleaners_declined" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-red-50 text-red-700 border border-red-200">
                <AlertTriangle className="w-3 h-3" />
                Needs attention
              </span>
            )}
          </div>
          {item.property && (
            <div className="text-sm text-gray-600 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              <span className="truncate">
                {item.property.address}, {item.property.city}, {item.property.state}
              </span>
            </div>
          )}
          <div className="text-sm text-gray-600 mt-0.5">
            {item.service_type?.name ?? "Service"}
            {item.service_type ? ` · $${item.service_type.base_price}` : null}
            {` · ${item.duration_minutes} min`}
          </div>

          {item.requested_slots.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.requested_slots.map((s) => (
                <span
                  key={s.slot_index}
                  className={
                    "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border " +
                    (s.slot_index === 0
                      ? "bg-primary-50 text-primary-700 border-primary-200"
                      : "bg-gray-50 text-gray-700 border-gray-200")
                  }
                >
                  {s.slot_index === 0 && (
                    <span className="text-[10px] uppercase tracking-wide font-semibold">
                      Primary
                    </span>
                  )}
                  {formatDateTimeTo12h(s.scheduled_date, s.scheduled_time)}
                </span>
              ))}
            </div>
          )}

          {finishedAttempts.length > 0 && (
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
            >
              {historyOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <History className="w-3 h-3" />
              {finishedAttempts.length} previous{" "}
              {finishedAttempts.length === 1 ? "attempt" : "attempts"}
            </button>
          )}
          {historyOpen && (
            <ul className="mt-1 ml-5 text-xs text-gray-600 space-y-0.5">
              {finishedAttempts.map((a) => {
                const label =
                  a.response === "expired"
                    ? routingDeclineReasonLabel("expired")
                    : a.decline_reason
                    ? routingDeclineReasonLabel(a.decline_reason)
                    : a.response;
                const who = a.cleaner_name ?? "Unknown cleaner";
                return (
                  <li key={a.attempt_index}>
                    <span className="font-medium text-gray-700">{who}</span>
                    <span className="text-gray-400"> — </span>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onAssign}
            className={
              "inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg whitespace-nowrap " +
              (item.reason === "all_cleaners_declined"
                ? "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                : "bg-primary-600 text-white hover:bg-primary-700")
            }
          >
            <UserCheck className="w-4 h-4" />
            {item.reason === "all_cleaners_declined"
              ? "Force-assign"
              : "Assign cleaner"}
          </button>
          {item.reason === "all_cleaners_declined" && item.homeowner?.phone && (
            <a
              href={`tel:${item.homeowner.phone}`}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Call {item.homeowner.phone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

interface CounterProposedRowProps {
  item: AdminActionItem;
  onAccept: (suggestedTimeId: string) => Promise<void>;
  onReassign: () => void;
  acceptingId: string | null;
}

function CounterProposedRow({ item, onAccept, onReassign, acceptingId }: CounterProposedRowProps) {
  const feedback = item.latest_feedback;
  const cleaner = cleanerNameFor(item);
  if (!feedback) {
    // Shouldn't happen — guard for type safety.
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {formatDateTimeTo12h(item.scheduled_date, item.scheduled_time)}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
            {customerName(item)}
            {item.property?.address ? ` · ${item.property.address}` : ""}
          </p>
          <p className="mt-1 text-xs text-blue-700 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {cleaner} proposed alternatives
            {feedback.reason ? ` — ${feedback.reason}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onReassign}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reassign
        </button>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="text-xs font-medium text-gray-700 mb-2">Cleaner suggested:</p>
        <div className="flex flex-wrap gap-2">
          {feedback.suggested_times.map((st) => {
            const accepting = acceptingId === st.id;
            return (
              <button
                key={st.id}
                type="button"
                disabled={accepting || acceptingId !== null}
                onClick={() => onAccept(st.id)}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors text-sm font-semibold focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {accepting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>
                  {formatDateTimeTo12h(st.suggested_date, st.suggested_time)}
                </span>
              </button>
            );
          })}
        </div>
        {feedback.suggested_windows.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-700 mb-1">Or any time within:</p>
            <ul className="space-y-1 text-sm text-gray-700">
              {feedback.suggested_windows.map((sw) => (
                <li key={sw.id} className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  {formatTimeTo12h(sw.start_time)} – {formatTimeTo12h(sw.end_time)} on{" "}
                  {sw.window_date}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface ReassignRowProps {
  item: AdminActionItem;
  onReassign: () => void;
}

function ReassignRow({ item, onReassign }: ReassignRowProps) {
  const isOverdue = item.reason === "cleaner_overdue";
  const cleaner = cleanerNameFor(item);
  const feedbackReason = item.latest_feedback?.reason ?? null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {formatDateTimeTo12h(item.scheduled_date, item.scheduled_time)}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
            {customerName(item)}
            {item.property?.address ? ` · ${item.property.address}` : ""}
          </p>
          <p
            className={
              "mt-1 text-xs inline-flex items-center gap-1 " +
              (isOverdue ? "text-red-700" : "text-amber-700")
            }
          >
            {isOverdue ? (
              <Hourglass className="w-3 h-3 shrink-0" />
            ) : (
              <AlertCircle className="w-3 h-3 shrink-0" />
            )}
            <span className="truncate">
              {isOverdue
                ? `${cleaner} hasn't responded — SLA elapsed`
                : `${cleaner} declined${feedbackReason ? `: ${feedbackReason}` : " this time"}`}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onReassign}
          className={
            "shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap " +
            (isOverdue
              ? "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
              : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100")
          }
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reassign
        </button>
      </div>
    </div>
  );
}

export default function ActionRequiredSection({
  onAppointmentClick: _onAppointmentClick,
  onReassign,
  defaultExpanded = true,
  assignAppointmentId,
  onAssignHandled,
}: ActionRequiredSectionProps) {
  const { orderedGroups, items, loading, refetch, acceptCounterProposal } =
    useAdminActionItems();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<AdminActionItem | null>(null);
  const [forceAssignTarget, setForceAssignTarget] = useState<AdminActionItem | null>(null);

  const assignSlots = useMemo(() => {
    const target = assignTarget ?? forceAssignTarget;
    if (!target) return [];
    if (target.requested_slots.length > 0) {
      return target.requested_slots.map((s) => ({
        date: s.scheduled_date,
        time: s.scheduled_time,
      }));
    }
    return [{ date: target.scheduled_date, time: target.scheduled_time }];
  }, [assignTarget, forceAssignTarget]);

  // Notification "Assign cleaner" deep-link: open the assignment modal for the
  // targeted appointment once it's present in the queue, then clear the intent.
  useEffect(() => {
    if (!assignAppointmentId) return;
    for (const g of orderedGroups) {
      const target = g.items.find((i) => i.id === assignAppointmentId);
      if (target) {
        if (g.reason === "awaiting_assignment") setAssignTarget(target);
        else setForceAssignTarget(target);
        break;
      }
    }
    onAssignHandled?.();
  }, [assignAppointmentId, orderedGroups, onAssignHandled]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden w-full">
        <div className="px-4 sm:px-5 py-4 flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading action items…
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  const handleAcceptCounter = async (appointmentId: string, suggestedTimeId: string) => {
    setAcceptingId(suggestedTimeId);
    try {
      await acceptCounterProposal({ appointmentId, suggestedTimeId });
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <>
      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden w-full">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors md:cursor-default md:hover:bg-transparent"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-primary-50 text-primary-600 shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <div className="text-left">
              <h3 className="text-lg font-bold text-gray-900">Action Required</h3>
              <p className="text-xs font-medium text-gray-500">
                {items.length} item{items.length === 1 ? "" : "s"} need your attention
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-semibold bg-primary-100 text-primary-700 rounded-full">
              {items.length}
            </span>
            <div className="md:hidden p-2 bg-gray-50 rounded-full">
              {expanded ? (
                <ChevronDown className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-500" />
              )}
            </div>
          </div>
        </button>

        <div
          className={`${expanded ? "" : "hidden md:block"} border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4 space-y-4`}
        >
          {orderedGroups.map(({ reason, items: groupItems }) => (
            <div key={reason}>
              <GroupHeader reason={reason} count={groupItems.length} />
              <div className="space-y-2">
                {groupItems.map((item) => {
                  if (
                    reason === "awaiting_assignment" ||
                    reason === "all_cleaners_declined"
                  ) {
                    return (
                      <AwaitingAssignmentRow
                        key={item.id}
                        item={item}
                        onAssign={() =>
                          reason === "all_cleaners_declined"
                            ? setForceAssignTarget(item)
                            : setAssignTarget(item)
                        }
                      />
                    );
                  }
                  if (reason === "counter_proposed") {
                    return (
                      <CounterProposedRow
                        key={item.id}
                        item={item}
                        onAccept={(stid) => handleAcceptCounter(item.id, stid)}
                        onReassign={() => onReassign?.(item)}
                        acceptingId={acceptingId}
                      />
                    );
                  }
                  return (
                    <ReassignRow
                      key={item.id}
                      item={item}
                      onReassign={() => onReassign?.(item)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {(assignTarget || forceAssignTarget) && (
        <AssignCleanerModal
          isOpen={true}
          onClose={() => {
            setAssignTarget(null);
            setForceAssignTarget(null);
          }}
          onAssigned={() => {
            setAssignTarget(null);
            setForceAssignTarget(null);
            refetch();
          }}
          appointmentId={(assignTarget ?? forceAssignTarget)!.id}
          propertyId={(assignTarget ?? forceAssignTarget)!.property_id}
          durationMinutes={(assignTarget ?? forceAssignTarget)!.duration_minutes}
          slots={assignSlots}
          excludeCleanerIds={
            assignTarget
              ? assignTarget.routing_log
                  .filter((l) => l.response !== "accepted")
                  .map((l) => l.cleaner_id)
              : []
          }
          forceMode={!!forceAssignTarget}
        />
      )}
    </>
  );
}
