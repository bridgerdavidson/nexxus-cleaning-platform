"use client";

import { AlertTriangle, Search, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { JobRow } from "../shared/JobRow";
import type { ScheduleData, ScheduleStatusFilter, ScheduleView } from "./schedule-types";

// Status options are scoped to the active view so the dropdown never offers a
// status that the view excludes (e.g. Completed under Upcoming), which would
// always return an empty, misleading list.
const STATUS_OPTIONS: Record<ScheduleView, { value: ScheduleStatusFilter; label: string }[]> = {
  upcoming: [
    { value: "all", label: "All statuses" },
    { value: "needs_response", label: "Needs response" },
    { value: "confirmed", label: "Upcoming" },
    { value: "in_progress", label: "In progress" },
  ],
  past: [
    { value: "all", label: "All statuses" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
};

export function CleanerScheduleView({
  data, loading, search, onSearchChange, view, onViewChange, statusFilter, onStatusFilterChange, onOpenJob, todayStr,
}: {
  data: ScheduleData;
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  view: ScheduleView;
  onViewChange: (v: ScheduleView) => void;
  statusFilter: ScheduleStatusFilter;
  onStatusFilterChange: (v: ScheduleStatusFilter) => void;
  onOpenJob: (id: string) => void;
  todayStr: string;
}) {
  return (
    <div className="space-y-4 pt-1">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search jobs" className="pl-9" aria-label="Search jobs" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          value={view}
          onChange={onViewChange}
          options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]}
        />
        <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as ScheduleStatusFilter)}>
          <SelectTrigger className="h-9 w-[150px] rounded-pill"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS[view].map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {data.needsAttention.length > 0 && (
        <section className="rounded-card border border-border bg-caution-50 p-3">
          <div className="mb-2 flex items-center gap-1.5 px-0.5">
            <AlertTriangle className="size-4 text-caution-700" aria-hidden />
            <h2 className="text-sm font-bold text-caution-700">Needs attention</h2>
            <span className="ml-auto text-xs font-bold text-caution-700">{data.needsAttention.length}</span>
          </div>
          <div className="space-y-2.5">
            {data.needsAttention.map((j) => (
              <JobRow key={j.id} appointment={j} todayStr={todayStr} onClick={() => onOpenJob(j.id)} />
            ))}
          </div>
        </section>
      )}

      {!loading && (
        <div className="px-0.5 text-xs font-medium text-muted-foreground">
          {data.total} {data.total === 1 ? "job" : "jobs"}
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-16 w-full rounded-card" />
        </div>
      ) : data.isEmpty && data.needsAttention.length === 0 ? (
        <div className="pt-10">
          <EmptyState
            icon={<CalendarDays />}
            title={view === "upcoming" ? "No upcoming jobs" : "No past jobs"}
            description={view === "upcoming" ? "New jobs and offers will appear here." : "Completed and cancelled jobs will appear here."}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {data.groups.map((g) => (
            <section key={g.key}>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <h2 className="text-sm font-bold">{g.label}</h2>
                <span className="ml-auto text-xs font-medium text-muted-foreground">{g.jobs.length}</span>
              </div>
              <div className="space-y-2.5">
                {g.jobs.map((j) => <JobRow key={j.id} appointment={j} todayStr={todayStr} onClick={() => onOpenJob(j.id)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
