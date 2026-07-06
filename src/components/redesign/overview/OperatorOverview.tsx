"use client";

import { useAuth } from "@/hooks/useAuth";
import { useAdminAppointments, useAdminStats, usePaymentStats, type AdminAppointment } from "@/hooks/useAdminData";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { OperatorOverviewView } from "./OperatorOverviewView";
import { deriveOverviewSections } from "./deriveOverview";
import { getGreeting, type ActiveItem, type QueueItem, type ScheduleItem } from "./overview-types";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useOperatorOnboarding } from "@/hooks/useOperatorOnboarding";
import { SetupChecklistCard } from "@/components/redesign/onboarding/SetupChecklistCard";
import { SetupCompleteCard } from "@/components/redesign/onboarding/SetupCompleteCard";
import { WelcomeContent } from "@/components/redesign/onboarding/WelcomeContent";
import { getWelcomeCopy } from "@/lib/onboarding/welcomeCopy";

// --- display mappers (AdminAppointment -> View display items) ---

function todayLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(t: string | undefined): string {
  const [hh, mm] = (t ?? "").split(":");
  let h = parseInt(hh ?? "0", 10);
  if (Number.isNaN(h)) return t ?? "";
  const m = mm ?? "00";
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m}${ap}`;
}

function fmtShortDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function propertyLabel(a: AdminAppointment): string {
  return a.property?.name || a.property?.address || "Property";
}
function serviceLabel(a: AdminAppointment): string {
  return a.service_type?.name || "Cleaning";
}
function cleanerLabel(a: AdminAppointment): string {
  const up = a.cleaner_profile?.user_profile;
  if (!up) return "Unassigned";
  const last = up.last_name ? `${up.last_name[0]}.` : "";
  return `${up.first_name ?? ""} ${last}`.trim() || "Cleaner";
}
function toQueueItem(a: AdminAppointment): QueueItem {
  return {
    id: a.id,
    title: `${propertyLabel(a)} · ${serviceLabel(a)}`,
    subtitle: `${fmtShortDate(a.scheduled_date)} · ${fmtTime(a.scheduled_time)}`,
  };
}

/**
 * Hook-backed Operator Overview. Consumes the existing headless admin hooks
 * unchanged, derives the triage sections, and feeds the presentational View.
 * Admin/owner see payments; managers are gated by can_view_payments.
 */
export function OperatorOverview() {
  const { user, currentOrgRole } = useAuth();
  const { appointments, loading: aLoading, error: aError, refetch: aRefetch } = useAdminAppointments();
  const { stats, loading: sLoading, error: sError, refetch: sRefetch } = useAdminStats();
  const { stats: payStats, loading: pLoading, error: pError, refetch: pRefetch } = usePaymentStats();
  const { permissions } = useManagerPermissions();
  const onboarding = useOperatorOnboarding();
  const welcomeCopy = getWelcomeCopy("operator", onboarding.welcomeVariant, onboarding.firstName);

  const now = new Date();
  const sections = deriveOverviewSections(appointments, todayLocalISO(now));

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canViewPayments = privileged || !!permissions?.can_view_payments;
  // Gate the payments error the same way as the loading prop below: a manager
  // who cannot view payments must never see the dashboard error surfaced by a
  // payments query.
  const hasError = Boolean(aError || sError || (canViewPayments && pError));
  const onRetry = () => { void aRefetch(); void sRefetch(); void pRefetch(); };
  const { greeting, dateLabel } = getGreeting(user?.profile?.firstName, now);

  const today: ScheduleItem[] = [...sections.today]
    .sort((a, b) => (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? ""))
    .map((a) => ({
      id: a.id,
      time: fmtTime(a.scheduled_time),
      title: `${propertyLabel(a)} · ${serviceLabel(a)} · ${cleanerLabel(a)}`,
    }));

  const activeNow: ActiveItem[] = sections.activeNow.map((a) => ({
    id: a.id,
    title: `${propertyLabel(a)} · ${cleanerLabel(a)}`,
  }));

  const showOnboarding = privileged;
  const checklist = showOnboarding && onboarding.showChecklist ? (
    <SetupChecklistCard
      title="Finish setting up your business"
      subtitle={`${onboarding.vm.requiredRemaining} ${onboarding.vm.requiredRemaining === 1 ? "step" : "steps"} left before you can take bookings`}
      vm={onboarding.vm}
      onDismiss={onboarding.onDismiss}
    />
  ) : showOnboarding && onboarding.showSuccess ? (
    <SetupCompleteCard onDismiss={onboarding.onDismiss} />
  ) : null;

  return (
    <>
      <OperatorOverviewView
        loading={aLoading || sLoading || (canViewPayments && pLoading)}
        error={hasError}
        onRetry={onRetry}
        greeting={greeting}
        dateLabel={dateLabel}
        kpis={{
          todayJobs: sections.today.length,
          inProgress: sections.activeNow.length,
          awaitingApproval: stats.pendingApprovals,
          revenueThisMonth: canViewPayments ? payStats.thisMonthRevenue : null,
          unassignedCount: sections.unassigned.length,
          canViewPayments,
        }}
        unassigned={sections.unassigned.map(toQueueItem)}
        declined={sections.declined.map(toQueueItem)}
        counterProposed={sections.counterProposed.map(toQueueItem)}
        today={today}
        activeNow={activeNow}
        checklist={checklist}
      />
      {privileged && onboarding.showWelcome && (
        <Dialog open onOpenChange={(open) => { if (!open) onboarding.onWelcomeDone(); }}>
          <DialogContent className="max-w-lg p-8">
            <WelcomeContent
              copy={welcomeCopy}
              previewSteps={onboarding.vm.items.filter((i) => i.required).map((i) => ({ title: i.title }))}
              onPrimary={onboarding.onWelcomeDone}
              onSkip={onboarding.onWelcomeDone}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
