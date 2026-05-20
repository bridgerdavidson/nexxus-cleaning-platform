"use client";

import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  UserCheck,
  History,
  AlertTriangle,
} from "lucide-react";
import { useAdminPendingRequests, type AdminPendingRequest } from "../../hooks/useAdminPendingRequests";
import { formatDateTimeTo12h } from "../../lib/formatTime";
import { routingDeclineReasonLabel } from "../../types";
import AssignCleanerModal from "../AssignCleanerModal";

function stateBadge(state: string) {
  if (state === "needs_admin_attention") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">
        <AlertTriangle className="w-3 h-3" /> Needs attention
      </span>
    );
  }
  if (state === "routing") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
        <Clock className="w-3 h-3" /> Awaiting cleaner
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
      <AlertCircle className="w-3 h-3" /> Unassigned
    </span>
  );
}

export default function AwaitingRequestsSection() {
  const { requests, loading, refetch } = useAdminPendingRequests();
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState<AdminPendingRequest | null>(null);

  const slotsForTarget = useMemo(() => {
    if (!assignTarget) return [];
    return assignTarget.requested_slots.map((s) => ({
      date: s.scheduled_date,
      time: s.scheduled_time,
    }));
  }, [assignTarget]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading requests…
      </div>
    );
  }
  if (requests.length === 0) return null;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden border-l-4 border-l-primary-500">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary-600" />
            <h3 className="text-lg font-semibold text-gray-900">Awaiting Requests</h3>
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-semibold bg-primary-100 text-primary-700 rounded-full">
              {requests.length}
            </span>
          </div>
          <span className="text-xs text-gray-500">
            Customer-submitted, needs admin assignment
          </span>
        </div>
        <div className="divide-y divide-gray-200">
          {requests.map((r) => {
            const customerName = `${r.homeowner?.first_name ?? ""} ${r.homeowner?.last_name ?? ""}`.trim() || r.homeowner?.email || "Customer";
            const isHistoryOpen = historyOpen.has(r.id);
            const finishedAttempts = r.routing_log.filter((l) => l.response !== "pending");
            const currentAttempt = r.routing_log.find((l) => l.response === "pending");
            return (
              <div key={r.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900">{customerName}</span>
                      {stateBadge(r.request_state)}
                      {r.request_state === "routing" && currentAttempt && (
                        <span className="text-xs text-gray-500">
                          attempt {currentAttempt.attempt_index}/3
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {r.property
                        ? `${r.property.address}, ${r.property.city}, ${r.property.state}`
                        : "Property unavailable"}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {r.service_type?.name ?? "Service"}
                      {r.service_type ? ` · $${r.service_type.base_price}` : null}
                      {` · ${r.duration_minutes} min`}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.requested_slots.map((s) => (
                        <span
                          key={s.slot_index}
                          className={[
                            "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border",
                            s.slot_index === 0
                              ? "bg-primary-50 text-primary-700 border-primary-200"
                              : "bg-gray-50 text-gray-700 border-gray-200",
                          ].join(" ")}
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

                    {finishedAttempts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          });
                        }}
                        className="mt-2 text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
                      >
                        {isHistoryOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <History className="w-3 h-3" />
                        {finishedAttempts.length} previous {finishedAttempts.length === 1 ? "attempt" : "attempts"}
                      </button>
                    )}
                    {isHistoryOpen && (
                      <ul className="mt-1 ml-5 text-xs text-gray-600 space-y-0.5">
                        {finishedAttempts.map((a) => {
                          const label =
                            a.response === "expired"
                              ? routingDeclineReasonLabel("expired")
                              : a.decline_reason
                              ? routingDeclineReasonLabel(a.decline_reason)
                              : a.response;
                          return (
                            <li key={a.attempt_index}>
                              #{a.attempt_index} — {label}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAssignTarget(r)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700"
                    >
                      <UserCheck className="w-4 h-4" />
                      {r.request_state === "needs_admin_attention" ? "Force-assign" : "Assign cleaner"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {assignTarget && (
        <AssignCleanerModal
          isOpen={!!assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => {
            refetch();
          }}
          appointmentId={assignTarget.id}
          propertyId={assignTarget.property_id}
          durationMinutes={assignTarget.duration_minutes}
          slots={slotsForTarget}
          excludeCleanerIds={assignTarget.routing_log
            .filter((l) => l.response !== "accepted")
            .map((l) => l.cleaner_id)}
        />
      )}
    </>
  );
}
