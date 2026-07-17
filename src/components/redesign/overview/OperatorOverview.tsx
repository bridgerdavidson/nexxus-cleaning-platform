"use client";

import { useAuth } from "@/hooks/useAuth";
import { useAdminAppointments, useAdminStats, usePaymentStats, type AdminAppointment } from "@/hooks/useAdminData";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { OperatorOverviewView } from "./OperatorOverviewView";
import { deriveOverviewSections } from "./deriveOverview";
import { buildTodayItems } from "./buildTodayItems";
import { fmtShortDate, fmtTime, getGreeting, type QueueItem } from "./overview-types";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useOperatorOnboarding } from "@/hooks/useOperatorOnboarding";
import { SetupChecklistCard } from "@/components/redesign/onboarding/SetupChecklistCard";
import { SetupCompleteCard } from "@/components/redesign/onboarding/SetupCompleteCard";
import { WelcomeContent } from "@/components/redesign/onboarding/WelcomeContent";
import { getWelcomeCopy } from "@/lib/onboarding/welcomeCopy";
import { useOpenBookingDetail } from "@/components/redesign/bookings/useOpenBookingDetail";
import { stripeNewChargeFlowUiEnabled } from "@/lib/stripe/flags";

// --- display mappers (AdminAppointment -> View display items) ---

function todayLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const sections = deriveOverviewSections(appointments, todayLocalISO(now), now.getTime());

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canViewPayments = privileged || !!permissions?.can_view_payments;
  // Gate the payments error the same way as the loading prop below: a manager
  // who cannot view payments must never see the dashboard error surfaced by a
  // payments query.
  const hasError = Boolean(aError || sError || (canViewPayments && pError));
  const onRetry = () => { void aRefetch(); void sRefetch(); void pRefetch(); };
  const { greeting, dateLabel } = getGreeting(user?.profile?.firstName, now);

  // Opens the booking sheet in place via the shell-level host (?booking=<id>);
  // no navigation away from the overview.
  const openBooking = useOpenBookingDetail();
  // Mirror the host's gate (can_view_bookings in OperatorShell): withhold the
  // handler for a restricted manager and the queue renders informational-only.
  const canViewBookings = privileged || !!permissions?.can_view_bookings;

  // Failed/requires-action charges surface in the queue only for viewers who can see money,
  // and only under the new charge flow (authorization_status is that flow's outcome mirror) —
  // the same gates as the Payments triage band.
  const failedPayment: QueueItem[] =
    stripeNewChargeFlowUiEnabled() && canViewPayments
      ? sections.failedPayment.map((a) => ({
          ...toQueueItem(a),
          subtitle: `${fmtShortDate(a.scheduled_date)} · ${
            a.authorization_status === "requires_action" ? "Card needs authentication" : "Card declined"
          }`,
        }))
      : [];

  const todayItems = buildTodayItems(sections.today, sections.activeNow, {
    todayISO: todayLocalISO(now),
    nowMs: now.getTime(),
    title: (a) => `${propertyLabel(a)} · ${serviceLabel(a)}`,
    cleaner: cleanerLabel,
  });

  // Onboarding is owner-only: the required "Set cleaner pay" step routes to the
  // owner-only Payout settings section, so an admin could not complete it (and the
  // legacy OwnerSetupChecklist was owner-only too). Admins/managers run day-to-day;
  // initial business setup (payout %, org profile, hours/policy) is the owner's.
  const showOnboarding = currentOrgRole === "owner";

  // Manager hero is "stripped down" by construction, not by a separate variant:
  // the greeting header below (OperatorOverviewView) is role-agnostic and never
  // carries a company-wide revenue figure or owner-only chrome of its own. The
  // only two hero-adjacent elements that need gating are handled already: the
  // setup checklist above (owner-only via showOnboarding) and the Revenue KPI
  // tile (gated on canViewPayments, dropped-not-swapped by KpiStrip below). A
  // non-privileged manager therefore already sees: compact greeting + today's
  // summary (KPI strip + Needs-you-now + Today/Active panels), with no revenue
  // banner and no owner setup prompt. The primary "New booking" action is a
  // global Operator affordance owned by OperatorShell/OperatorTopBar (outside
  // this file); gating it on can_edit_bookings is tracked under the Task 5
  // component-level gating audit, not duplicated here.
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
          canViewPayments,
        }}
        unassigned={sections.unassigned.map(toQueueItem)}
        declined={sections.declined.map(toQueueItem)}
        counterProposed={sections.counterProposed.map(toQueueItem)}
        overdue={sections.overdue.map((a) => ({
          ...toQueueItem(a),
          subtitle: `${fmtShortDate(a.scheduled_date)} · ${fmtTime(a.scheduled_time)} · ${cleanerLabel(a)} has not responded`,
        }))}
        failedPayment={failedPayment}
        onOpenBooking={canViewBookings ? openBooking : undefined}
        paymentsHref={canViewPayments ? "/app/admin-dashboard/payments" : undefined}
        todayItems={todayItems}
        checklist={checklist}
      />
      {showOnboarding && onboarding.showWelcome && (
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
