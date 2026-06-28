"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCleanerAppointments } from "@/hooks/useCleanerData";
import { useOpenJob } from "../job/useOpenJob";
import { NEEDS_ATTENTION_DAYS } from "../shared/zones";
import { deriveSchedule } from "./deriveSchedule";
import { CleanerScheduleView } from "./CleanerScheduleView";
import type { ScheduleStatusFilter, ScheduleView } from "./schedule-types";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerSchedule() {
  const { currentOrganization } = useAuth();
  const { appointments, loading } = useCleanerAppointments();
  const openJob = useOpenJob();
  const isEmployee = (currentOrganization?.default_payout_model ?? "percentage_contractor") !== "percentage_contractor";
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ScheduleView>("upcoming");
  const [statusFilter, setStatusFilter] = useState<ScheduleStatusFilter>("all");

  // If the org resolves to the employee model while "needs response" was the
  // active filter (it's hidden for employees), reset it so the list isn't stuck
  // empty.
  useEffect(() => {
    if (isEmployee && statusFilter === "needs_response") setStatusFilter("all");
  }, [isEmployee, statusFilter]);

  const dateStrs = useMemo(() => {
    const now = new Date();
    return {
      todayStr: ymd(now),
      tomorrowStr: ymd(new Date(now.getTime() + 864e5)),
      weekEndStr: ymd(new Date(now.getTime() + 6 * 864e5)),
      graceFloorStr: ymd(new Date(now.getTime() - NEEDS_ATTENTION_DAYS * 864e5)),
    };
  }, []);

  const data = useMemo(
    () => deriveSchedule(appointments, { search, statusFilter, view, ...dateStrs }),
    [appointments, search, statusFilter, view, dateStrs],
  );

  return (
    <CleanerScheduleView
      data={data} loading={loading} isEmployee={isEmployee}
      search={search} onSearchChange={setSearch}
      view={view} onViewChange={(v) => { setView(v); setStatusFilter("all"); }}
      statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
      onOpenJob={openJob} todayStr={dateStrs.todayStr}
    />
  );
}
