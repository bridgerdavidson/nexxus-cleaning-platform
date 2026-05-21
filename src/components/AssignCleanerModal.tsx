"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, UserCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { formatTimeTo12h } from "../lib/formatTime";
import {
  rankCleanersByMultiSlotCoverage,
  type CleanerLike,
  type CleanerMetrics,
  type MultiSlotRanking,
  type SlotCandidate,
} from "../lib/cleanerAvailability";
import type { ScheduleAppointment } from "../lib/appointmentConflicts";

/** Compact "Thu May 21 · 8:11 PM" for the conflict-explanation row. */
function formatDateTimeShort(date: string, time: string): string {
  if (!date) return formatTimeTo12h(time);
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const formattedDate = dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${formattedDate} · ${formatTimeTo12h(time)}`;
}

interface AssignCleanerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssigned: () => void;
  appointmentId: string;
  propertyId: string;
  durationMinutes: number;
  slots: SlotCandidate[];
  excludeCleanerIds?: string[];
  /** Force-assign past the routing chain (used by RescheduleRequired's
   *  "all cleaners declined" surface). Hides the offered-slot chip at the top
   *  and per-cleaner availability badges/conflict line, since the admin is
   *  explicitly overriding the auto-routing decision. */
  forceMode?: boolean;
}

interface RawCleaner {
  id: string;
  user_profile:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
}

export default function AssignCleanerModal({
  isOpen,
  onClose,
  onAssigned,
  appointmentId,
  propertyId,
  durationMinutes,
  slots,
  excludeCleanerIds = [],
  forceMode = false,
}: AssignCleanerModalProps) {
  const { currentOrganizationId, accessToken } = useAuth();
  const orgId = currentOrganizationId ?? "";
  useBodyScrollLock(isOpen);

  const [loading, setLoading] = useState(false);
  const [ranking, setRanking] = useState<MultiSlotRanking<CleanerLike>[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !orgId || slots.length === 0) return;
    setError(null);
    setLoading(true);
    (async () => {
      try {
        // Active cleaners in this org.
        const { data: cleanerRows } = await supabase
          .from("cleaner_profiles")
          .select("id, user_profile:user_profiles!id(first_name, last_name)")
          .eq("organization_id", orgId)
          .eq("is_available", true);
        const cleaners: CleanerLike[] = ((cleanerRows ?? []) as RawCleaner[]).map((r) => ({
          id: r.id,
          user_profile: r.user_profile && !Array.isArray(r.user_profile)
            ? r.user_profile
            : Array.isArray(r.user_profile)
              ? r.user_profile[0]
              : null,
        }));
        if (cleaners.length === 0) {
          setRanking([]);
          setLoading(false);
          return;
        }
        const cleanerIds = cleaners.map((c) => c.id);
        const dates = Array.from(new Set(slots.map((s) => s.date)));

        // Existing schedule for each cleaner on the offered dates. Includes
        // the conflicting appointment's homeowner so we can render
        // "Booked: <homeowner> · <date time>" in the busy row.
        const { data: scheduleRows } = await supabase
          .from("appointments")
          .select(
            "id, cleaner_id, status, scheduled_date, scheduled_time, duration_minutes, homeowner:user_profiles!homeowner_id(first_name, last_name)",
          )
          .in("cleaner_id", cleanerIds)
          .in("scheduled_date", dates);
        type ScheduleRow = ScheduleAppointment & {
          cleaner_id: string | null;
          homeowner:
            | { first_name: string | null; last_name: string | null }
            | { first_name: string | null; last_name: string | null }[]
            | null;
        };
        const schedulesByCleaner: Record<string, ScheduleAppointment[]> = {};
        for (const row of (scheduleRows ?? []) as ScheduleRow[]) {
          if (!row.cleaner_id) continue;
          const ho = Array.isArray(row.homeowner) ? row.homeowner[0] : row.homeowner;
          const name = ho
            ? `${ho.first_name ?? ""} ${ho.last_name ?? ""}`.trim()
            : "";
          const list = schedulesByCleaner[row.cleaner_id] ?? [];
          list.push({
            id: row.id,
            status: row.status,
            scheduled_date: row.scheduled_date,
            scheduled_time: row.scheduled_time,
            duration_minutes: row.duration_minutes,
            homeowner_name: name || null,
          });
          schedulesByCleaner[row.cleaner_id] = list;
        }

        // Last-worked-this-property — drives the recency tiebreak in the ranker.
        const { data: lastWorkedRows } = await supabase
          .from("appointments")
          .select("cleaner_id, scheduled_date")
          .in("cleaner_id", cleanerIds)
          .eq("property_id", propertyId)
          .order("scheduled_date", { ascending: false });
        const recent: Record<string, string> = {};
        for (const r of (lastWorkedRows ?? []) as Array<{ cleaner_id: string; scheduled_date: string }>) {
          if (!recent[r.cleaner_id]) recent[r.cleaner_id] = r.scheduled_date;
        }
        const today = new Date();
        const metrics: Record<string, CleanerMetrics> = {};
        for (const id of cleanerIds) {
          let lastWorkedDaysAgo: number | null = null;
          const d = recent[id];
          if (d) {
            const [y, m, day] = d.split("-").map(Number);
            const dt = new Date(y, m - 1, day);
            lastWorkedDaysAgo = Math.max(
              0,
              Math.floor((today.getTime() - dt.getTime()) / (24 * 60 * 60 * 1000)),
            );
          }
          metrics[id] = { lastWorkedDaysAgo };
        }

        const ranked = rankCleanersByMultiSlotCoverage(
          cleaners,
          schedulesByCleaner,
          slots,
          durationMinutes,
          metrics,
          excludeCleanerIds,
        );
        setRanking(ranked);
      } catch (err) {
        console.error(err);
        setError("Failed to load cleaners");
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, orgId, slots, propertyId, durationMinutes, excludeCleanerIds]);

  const assign = async (cleanerId: string) => {
    if (!accessToken) return;
    setAssigning(cleanerId);
    setError(null);
    try {
      const response = await fetch("/api/appointments/assign-cleaner", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          appointmentId,
          cleanerId,
          organizationId: orgId,
          forceAssign: forceMode,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to assign cleaner");
      }
      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign cleaner");
    } finally {
      setAssigning(null);
    }
  };

  const orderedSlots = useMemo(() => slots, [slots]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] overflow-y-auto">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white px-8 py-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">
                  {forceMode ? "Force-assign a cleaner" : "Assign a cleaner"}
                </h2>
                <p className="text-primary-100 text-sm">
                  {forceMode
                    ? "Pick any cleaner — availability checks are skipped."
                    : "Pick from the ranked list — coverage badges show which offered times they can take."}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
            {!forceMode && (
              <div className="mb-4 text-xs text-gray-500 flex flex-wrap gap-2">
                {orderedSlots.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded">
                    <span className="font-medium">{i === 0 ? "Primary" : `Alt ${i}`}:</span>
                    {formatDateTimeShort(s.date, s.time)}
                  </span>
                ))}
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" /> Ranking cleaners…
              </div>
            ) : ranking.length === 0 ? (
              <p className="text-gray-500 text-sm py-8 text-center">
                No active cleaners available in this organization.
              </p>
            ) : (
              <div className="space-y-2">
                {ranking.map((r) => {
                  const name = `${r.cleaner.user_profile?.first_name ?? ""} ${r.cleaner.user_profile?.last_name ?? ""}`.trim() || "Cleaner";
                  return (
                    <div
                      key={r.cleaner.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:border-primary-300 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{name}</div>
                        <div className="flex items-center gap-2 mt-1 text-xs flex-wrap">
                          {!forceMode &&
                            (["primary", "alt1", "alt2"] as const)
                              .filter((k, i) => i < orderedSlots.length)
                              .map((k, i) => (
                                <span
                                  key={k}
                                  className={
                                    "px-1.5 py-0.5 rounded " +
                                    (r.slotCoverage[k]
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-red-100 text-red-700")
                                  }
                                >
                                  {i === 0 ? "Primary" : `Alt ${i}`}: {r.slotCoverage[k] ? "free" : "busy"}
                                </span>
                              ))}
                          {!forceMode && r.firstConflict ? (
                            <span className="text-gray-500">
                              Booked:{" "}
                              {r.firstConflict.homeowner_name || "another client"}
                              {" · "}
                              {formatDateTimeShort(
                                r.firstConflict.scheduled_date,
                                r.firstConflict.scheduled_time,
                              )}
                            </span>
                          ) : r.lastWorkedDaysAgo === null ? (
                            <span className="text-gray-500">Never worked here</span>
                          ) : (
                            <span className="text-gray-500">
                              {r.lastWorkedDaysAgo === 0
                                ? "worked here today"
                                : `worked here ${r.lastWorkedDaysAgo}d ago`}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => assign(r.cleaner.id)}
                        disabled={!!assigning}
                        className="px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
                      >
                        {assigning === r.cleaner.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Assign
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
