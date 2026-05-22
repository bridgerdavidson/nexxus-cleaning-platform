"use client";

import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Loader2,
  MapPin,
  Search,
  Star,
} from "lucide-react";
import AppointmentCard, {
  AppointmentCardData,
} from "../AppointmentCard";
import ActiveNowSection from "../ActiveNowSection";
import {
  DASHBOARD_HERO_BACKGROUND,
  dashboardHeroCardDesktopClass,
  dashboardHeroCardMobileClass,
} from "../../lib/dashboardHero";
import { formatDateTimeTo12h } from "../../lib/formatTime";
import type { HomeownerRequest } from "../../hooks/useHomeownerRequests";

interface HomePageProps {
  firstName: string | null | undefined;
  appointments: AppointmentCardData[];
  appointmentsLoading: boolean;
  appointmentsError: string | null;
  pendingRequests: HomeownerRequest[];
  cancellingRequest: boolean;
  onCancelRequestClick: (requestId: string) => void;
  onOpenAppointment: (appointmentId: string) => void;
}

type UpcomingDays = 7 | 30 | -1;
const PAST_PAGE_SIZE = 10;

function getTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function HomePage({
  firstName,
  appointments,
  appointmentsLoading,
  appointmentsError,
  pendingRequests,
  cancellingRequest,
  onCancelRequestClick,
  onOpenAppointment,
}: HomePageProps) {
  const [todayExpanded, setTodayExpanded] = useState(true);
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [upcomingDays, setUpcomingDays] = useState<UpcomingDays>(30);
  const [upcomingShowAll, setUpcomingShowAll] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [pastPage, setPastPage] = useState(1);
  const [pastSearch, setPastSearch] = useState("");

  const todayStr = useMemo(getTodayString, []);

  const activeAppointments = useMemo(
    () => appointments.filter((a) => a.status === "in_progress"),
    [appointments],
  );

  const todaysAppointments = useMemo(
    () =>
      appointments
        .filter(
          (a) => a.scheduled_date === todayStr && a.status !== "in_progress",
        )
        .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)),
    [appointments, todayStr],
  );

  const upcomingAppointments = useMemo(() => {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const endDate = new Date(todayDate);
    if (upcomingDays !== -1) {
      endDate.setDate(endDate.getDate() + upcomingDays);
    }
    return appointments
      .filter((apt) => {
        if (apt.scheduled_date <= todayStr) return false;
        if (apt.status === "completed" || apt.status === "cancelled") return false;
        if (upcomingDays !== -1) {
          const [y, m, d] = apt.scheduled_date.split("-").map(Number);
          const aptDate = new Date(y, m - 1, d);
          if (aptDate > endDate) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
  }, [appointments, upcomingDays, todayStr]);

  const visibleUpcoming = upcomingShowAll
    ? upcomingAppointments
    : upcomingAppointments.slice(0, 5);

  const pastAppointments = useMemo(() => {
    const filtered = appointments.filter((apt) => {
      if (apt.scheduled_date >= todayStr) {
        return apt.status === "completed" || apt.status === "cancelled";
      }
      return true;
    });
    const sorted = filtered.sort((a, b) => {
      const dateCompare = b.scheduled_date.localeCompare(a.scheduled_date);
      if (dateCompare !== 0) return dateCompare;
      return b.scheduled_time.localeCompare(a.scheduled_time);
    });
    if (!pastSearch.trim()) return sorted;
    const q = pastSearch.toLowerCase();
    return sorted.filter((apt) => {
      const property = apt.property
        ? `${apt.property.address ?? ""} ${apt.property.city ?? ""} ${apt.property.state ?? ""}`.toLowerCase()
        : "";
      const cleaner = apt.cleaner_profile?.user_profile
        ? `${apt.cleaner_profile.user_profile.first_name} ${apt.cleaner_profile.user_profile.last_name}`.toLowerCase()
        : "";
      const service = apt.service_type?.name?.toLowerCase() ?? "";
      return (
        property.includes(q) ||
        cleaner.includes(q) ||
        service.includes(q)
      );
    });
  }, [appointments, todayStr, pastSearch]);

  const visiblePast = pastAppointments.slice(0, pastPage * PAST_PAGE_SIZE);
  const hasMorePast = pastAppointments.length > visiblePast.length;

  const upcomingDaysLabel: Record<UpcomingDays, string> = {
    7: "Next 7 days",
    30: "Next 30 days",
    [-1]: "All upcoming",
  };

  const dateNow = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [],
  );

  return (
    <>
      {/* Mobile Hero — CTA lives in the floating action button at the page level */}
      <div className="md:hidden mb-6 mt-2">
        <div
          className={dashboardHeroCardMobileClass}
          style={DASHBOARD_HERO_BACKGROUND}
        >
          <div className="relative">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-white/80 px-2.5 py-0.5 text-[10px] font-semibold text-primary-700 uppercase tracking-wider">
              <Star className="h-3 w-3" />
              Homeowner Dashboard
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Hello, {firstName || "there"}
            </h1>
            <p className="text-gray-600 mt-1 text-sm font-medium">{dateNow}</p>
          </div>
        </div>
      </div>

      {/* Desktop Hero (CTA lives in TopBar) */}
      <div className="hidden md:block mb-6">
        <div
          className={dashboardHeroCardDesktopClass}
          style={DASHBOARD_HERO_BACKGROUND}
        >
          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white/80 px-3 py-1 text-xs font-semibold text-primary-700">
              <Star className="h-3.5 w-3.5" />
              Homeowner Dashboard
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
              Welcome back, {firstName || "there"}
            </h1>
            <p className="mt-2 max-w-2xl text-base md:text-lg text-gray-600">
              Here&apos;s what&apos;s coming up. Need another cleaning? Tap{" "}
              <span className="font-semibold text-gray-800">Request Cleaning</span>{" "}
              in the top right anytime.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Pending Requests */}
        {pendingRequests.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                Pending Requests
              </h2>
              <p className="text-xs text-gray-500">
                Awaiting confirmation from your cleaning team
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="px-4 sm:px-5 py-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        {req.service_type?.name ?? "Cleaning"}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
                        <Clock className="w-3 h-3" />
                        Pending confirmation
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 truncate">
                      {req.property
                        ? `${req.property.address}, ${req.property.city}, ${req.property.state}`
                        : "Property"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {req.requested_slots
                        .slice()
                        .sort((a, b) => a.slot_index - b.slot_index)
                        .map((s) => (
                          <span
                            key={s.slot_index}
                            className={[
                              "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border",
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
                            {formatDateTimeTo12h(
                              s.scheduled_date,
                              s.scheduled_time,
                            )}
                          </span>
                        ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCancelRequestClick(req.id)}
                    disabled={cancellingRequest}
                    style={{ touchAction: "manipulation" }}
                    className="min-h-11 px-3 text-sm text-gray-500 hover:text-red-600 disabled:opacity-50 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Active Cleanings */}
        {activeAppointments.length > 0 && (
          <ActiveNowSection
            title="Active Cleanings"
            appointments={activeAppointments}
            loading={appointmentsLoading}
          >
            <div className="space-y-3">
              {activeAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  onClick={() => onOpenAppointment(appointment.id)}
                  role="homeowner"
                />
              ))}
            </div>
          </ActiveNowSection>
        )}

        {/* Today's Appointments — compact one-row when empty (matches admin/cleaner) */}
        {!appointmentsLoading && todaysAppointments.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden w-full">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-gray-50 text-gray-600 shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-gray-900 truncate">
                  Today&apos;s Appointments
                </h2>
              </div>
              <div
                className="sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-[11px] font-semibold shrink-0"
                aria-label="Nothing scheduled today"
              >
                <CheckCircle className="w-3 h-3 text-green-600" />
                <span>All clear</span>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold shrink-0">
                <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                <span>Nothing scheduled today</span>
              </div>
            </div>
          </div>
        ) : (
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setTodayExpanded((v) => !v)}
              aria-expanded={todayExpanded}
              aria-controls="today-appointments-body"
              style={{ touchAction: "manipulation" }}
              className="w-full min-h-11 flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-50 text-gray-600 rounded-xl">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h2 className="text-lg font-bold text-gray-900">
                    Today&apos;s Appointments
                  </h2>
                  <span className="text-xs font-medium text-gray-500">
                    {todaysAppointments.length} scheduled
                  </span>
                </div>
              </div>
              <div className="p-2 bg-gray-50 rounded-full">
                {todayExpanded ? (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                )}
              </div>
            </button>
            {todayExpanded && (
              <div
                id="today-appointments-body"
                className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4"
              >
                {appointmentsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-600">Loading schedule…</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {todaysAppointments.map((appointment) => (
                      <AppointmentCard
                        key={appointment.id}
                        appointment={appointment}
                        onClick={() => onOpenAppointment(appointment.id)}
                        role="homeowner"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Upcoming Appointments */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setUpcomingExpanded((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setUpcomingExpanded((v) => !v);
              }
            }}
            aria-expanded={upcomingExpanded}
            aria-controls="upcoming-appointments-body"
            style={{ touchAction: "manipulation" }}
            className="w-full min-h-11 flex items-center justify-between gap-3 px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-gray-50 text-gray-600 rounded-xl shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="text-left min-w-0">
                <h2 className="text-lg font-bold text-gray-900">
                  Upcoming Appointments
                </h2>
                <span className="text-xs font-medium text-gray-500">
                  {upcomingAppointments.length} in {upcomingDaysLabel[upcomingDays].toLowerCase()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Desktop: tiny iOS-style segmented control */}
              <div
                role="radiogroup"
                aria-label="Time range"
                onClick={(e) => e.stopPropagation()}
                className="hidden md:inline-flex items-center rounded-full bg-gray-100 p-0.5"
              >
                {([7, 30, -1] as UpcomingDays[]).map((d) => {
                  const active = d === upcomingDays;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={(e) => {
                        e.stopPropagation();
                        setUpcomingDays(d);
                        setUpcomingShowAll(false);
                      }}
                      className={[
                        "h-8 px-3 rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
                        active
                          ? "bg-primary-600 text-white shadow-sm"
                          : "text-gray-600 hover:text-gray-900",
                      ].join(" ")}
                    >
                      {d === 7 ? "7d" : d === 30 ? "30d" : "All"}
                    </button>
                  );
                })}
              </div>

              <div className="p-2 bg-gray-50 rounded-full">
                {upcomingExpanded ? (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                )}
              </div>
            </div>
          </div>
          {upcomingExpanded && (
            <div
              id="upcoming-appointments-body"
              className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4"
            >
              {/* Mobile: same segmented control as desktop, but in the body */}
              <div
                role="radiogroup"
                aria-label="Time range"
                className="md:hidden inline-flex items-center rounded-full bg-gray-100 p-0.5 mb-3"
              >
                {([7, 30, -1] as UpcomingDays[]).map((d) => {
                  const active = d === upcomingDays;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setUpcomingDays(d);
                        setUpcomingShowAll(false);
                      }}
                      style={{ touchAction: "manipulation" }}
                      className={[
                        "h-9 px-4 rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
                        active
                          ? "bg-primary-600 text-white shadow-sm"
                          : "text-gray-600 hover:text-gray-900",
                      ].join(" ")}
                    >
                      {d === 7 ? "7d" : d === 30 ? "30d" : "All"}
                    </button>
                  );
                })}
              </div>
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">Loading…</span>
                </div>
              ) : appointmentsError ? (
                <div className="text-center py-8" role="status">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
                  <p className="text-red-600">Failed to load appointments</p>
                </div>
              ) : upcomingAppointments.length > 0 ? (
                <div className="space-y-3">
                  {visibleUpcoming.map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={appointment}
                      onClick={() => onOpenAppointment(appointment.id)}
                      role="homeowner"
                    />
                  ))}
                  {!upcomingShowAll && upcomingAppointments.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setUpcomingShowAll(true)}
                      style={{ touchAction: "manipulation" }}
                      className="w-full min-h-11 text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                    >
                      Show all {upcomingAppointments.length} upcoming
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8" role="status">
                  <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">
                    No upcoming appointments in {upcomingDaysLabel[upcomingDays].toLowerCase()}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Past Appointments — collapsible, default closed */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setPastExpanded((v) => !v)}
            aria-expanded={pastExpanded}
            aria-controls="past-appointments-body"
            style={{ touchAction: "manipulation" }}
            className="w-full min-h-11 flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-50 text-gray-600 rounded-xl">
                <History className="w-5 h-5" />
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-gray-900">
                  Past Appointments
                </h2>
                <span className="text-xs font-medium text-gray-500">
                  {pastAppointments.length} total
                </span>
              </div>
            </div>
            <div className="p-2 bg-gray-50 rounded-full">
              {pastExpanded ? (
                <ChevronDown className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-500" />
              )}
            </div>
          </button>
          {pastExpanded && (
            <div
              id="past-appointments-body"
              className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4"
            >
              {pastAppointments.length > 0 || pastSearch ? (
                <>
                  <div className="mb-3 relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={pastSearch}
                      onChange={(e) => {
                        setPastSearch(e.target.value);
                        setPastPage(1);
                      }}
                      placeholder="Search past appointments…"
                      className="w-full pl-9 pr-3 py-2.5 min-h-11 text-base bg-white border border-gray-200 rounded-lg placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500"
                    />
                  </div>
                  {visiblePast.length > 0 ? (
                    <div className="space-y-3">
                      {visiblePast.map((appointment) => (
                        <AppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          onClick={() => onOpenAppointment(appointment.id)}
                          role="homeowner"
                        />
                      ))}
                      {hasMorePast && (
                        <button
                          type="button"
                          onClick={() => setPastPage((p) => p + 1)}
                          style={{ touchAction: "manipulation" }}
                          className="w-full min-h-11 text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                        >
                          Load more ({pastAppointments.length - visiblePast.length} remaining)
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8" role="status">
                      <Search className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-600">
                        No past appointments match &ldquo;{pastSearch}&rdquo;
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8" role="status">
                  <History className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">No past appointments yet</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
