"use client";

// Settings > Plan and billing. The calm, always-reachable counterpart to the
// paywall (ruling R3): a compact summary of what this company pays, with a
// "Change plan" action that opens the SAME PlanPicker the paywall mounts.
// Deliberately not a permanent pricing table.
//
// Every branch decision (which of the eight billing states renders what, and
// which controls an admin may actually use) lives in billingSectionModel.ts,
// under unit test. This file renders the answer and owns the side effects.
//
// SEAM FOR TASK 11: hosted Checkout returns the customer to
// /admin/settings?section=billing&checkout=success, which lands on THIS
// component. The `?checkout=` return handler (read the param, confirm the new
// plan, clear the param with replaceSearchShallow) mounts here. Not built in
// this task.

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PlanPicker } from "@/components/redesign/billing/PlanPicker";
import {
  changePlan,
  extendTrial,
  getPortalUrl,
  type PlanSelectionBody,
} from "@/components/redesign/billing/billing-api";
import { asBillingPeriod, asPlanTier } from "@/components/redesign/billing/paywallModel";
import {
  actionStateFor,
  billingSectionView,
  BADGE_VARIANT_FOR_TONE,
  type BillingActionKind,
  type BillingSectionAction,
} from "@/components/redesign/billing/billingSectionModel";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/hooks/useAuth";
import { useBilling } from "@/hooks/useBilling";
import { keys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionSkeleton } from "../SettingRow";

const EXTEND_ERROR = "Could not extend your trial. Please try again.";
const PORTAL_ERROR = "Could not open the billing portal. Please try again.";
const PLAN_UPDATED = "Your plan is updated";

export function BillingSection() {
  const { access, billing, seatsInUse, currentPeriodEnd, isOwner, canSeeBillingChrome, uiEnabled, isLoading } =
    useBilling();
  const { currentOrganizationId } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [picking, setPicking] = React.useState(false);
  const [pending, setPending] = React.useState<BillingActionKind | null>(null);

  const orgId = currentOrganizationId ?? "";

  const view = billingSectionView({
    uiEnabled,
    // Owner or admin. Without it the model cannot tell an admin from a manager
    // and would hand a manager a live portal button (ruling R24).
    canSeeBillingChrome,
    // The org id arrives after auth bootstrap, and useOrgQuery stays DISABLED
    // until it does, which reports isLoading false with no data. Without this
    // the section would flash "could not load your plan details" on every cold
    // open before the query has even been allowed to run.
    isLoading: isLoading || !orgId,
    access,
    seatsInUse,
    tier: asPlanTier(billing?.plan_tier),
    period: asBillingPeriod(billing?.billing_period),
    seatCount: billing?.seat_count ?? null,
    currentPeriodEnd,
    cancelAt: billing?.subscription_cancel_at ?? null,
    pauseResumesAt: billing?.billing_pause_resumes_at ?? null,
  });

  async function openPortal(kind: BillingActionKind): Promise<void> {
    setPending(kind);
    try {
      const url = await getPortalUrl(orgId, window.location.href);
      window.location.href = url;
    } catch {
      showToast(PORTAL_ERROR, { variant: "error" });
      setPending(null);
    }
  }

  async function handleExtend(): Promise<void> {
    setPending("extend");
    try {
      await extendTrial(orgId);
      await queryClient.invalidateQueries({ queryKey: keys.billing.all });
    } catch {
      showToast(EXTEND_ERROR, { variant: "error" });
    } finally {
      setPending(null);
    }
  }

  function handleAction(action: BillingSectionAction): void {
    if (action.kind === "choose-plan" || action.kind === "change-plan") setPicking(true);
    else if (action.kind === "extend") void handleExtend();
    else void openPortal(action.kind);
  }

  async function handleSubmit(sel: PlanSelectionBody): Promise<void> {
    // One route for both paths: with no live subscription it hands back a
    // hosted Checkout URL (ruling R10) instead of applying the change.
    const result = await changePlan(orgId, sel);
    if (result?.checkout_url) {
      window.location.href = result.checkout_url;
      return;
    }
    await queryClient.invalidateQueries({ queryKey: keys.billing.all });
    setPicking(false);
    showToast(PLAN_UPDATED, { variant: "success" });
  }

  if (view.kind === "disabled" || view.kind === "unavailable") {
    return <p className="text-sm text-muted-foreground">{view.message}</p>;
  }
  if (view.kind === "loading") return <SectionSkeleton />;

  const { spec } = view;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-w-0 space-y-4">
        <SectionHeader title="Plan and billing" lead={spec.lead} />

        {spec.notice ? (
          <p className="flex items-start gap-2 rounded-card bg-critical-50 px-4 py-3 text-sm font-semibold text-critical-700 dark:bg-critical/15 dark:text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">{spec.notice.message}</span>
          </p>
        ) : null}

        <Card className="min-w-0 space-y-4 p-5">
          <Badge variant={BADGE_VARIANT_FOR_TONE[spec.card.tone]}>{spec.card.badgeLabel}</Badge>
          <div className="min-w-0 space-y-1">
            <p className="text-2xl font-bold tabular-nums text-foreground">{spec.card.headline}</p>
            {spec.card.lines.map((line) => (
              <p
                key={line.text}
                className={cn(
                  "text-sm",
                  line.tone === "caution"
                    ? "font-semibold text-caution-700 dark:text-caution"
                    : "text-muted-foreground",
                )}
              >
                {line.text}
              </p>
            ))}
          </div>

          {spec.actions.length ? (
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {spec.actions.map((action) => (
                <ActionButton
                  key={action.kind}
                  action={action}
                  isOwner={isOwner}
                  loading={pending === action.kind}
                  onClick={() => handleAction(action)}
                />
              ))}
            </div>
          ) : null}
        </Card>

        {picking && spec.pickerSubmitLabel ? (
          <div className="pt-2">
            <PlanPicker
              seatsInUse={seatsInUse}
              currentTier={asPlanTier(billing?.plan_tier)}
              currentPeriod={asBillingPeriod(billing?.billing_period)}
              currentSeats={billing?.seat_count ?? null}
              orgId={orgId}
              submitLabel={spec.pickerSubmitLabel}
              onSubmit={handleSubmit}
              footer={
                <Button variant="outline" onClick={() => setPicking(false)}>
                  Cancel
                </Button>
              }
            />
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

/**
 * Ruling R15 v3: a money control an admin cannot use is DISABLED WITH A
 * REASON, never hidden. Radix needs a real trigger to hover or focus, and a
 * disabled button fires no pointer events at all, so the focusable wrapper
 * span is what makes the reason reachable by mouse, keyboard and screen
 * reader. Dropping it would leave a dead control with no explanation, which is
 * the exact failure this design exists to prevent.
 */
function ActionButton({
  action,
  isOwner,
  loading,
  onClick,
}: {
  action: BillingSectionAction;
  isOwner: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const state = actionStateFor(action, isOwner);
  const button = (
    <Button
      variant={action.variant}
      loading={loading}
      disabled={state.disabled}
      onClick={onClick}
    >
      {action.label}
    </Button>
  );

  if (!state.reason) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{state.reason}</TooltipContent>
    </Tooltip>
  );
}
