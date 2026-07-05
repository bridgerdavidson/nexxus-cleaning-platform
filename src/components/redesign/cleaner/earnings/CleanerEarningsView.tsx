// src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx
"use client";

import type { ReactNode } from "react";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PayoutTimingNotice from "@/components/PayoutTimingNotice";
import { money2, TxnStatusBadge } from "@/components/redesign/payments/payments-presenters";
import { formatCardDate } from "@/components/redesign/cleaner/shared/job-presenters";
import { ErrorState } from "@/components/ui/error-state";
import type { ClearingRow, ClearingSettleKind, ConnectKind, EarningsData } from "./earnings-types";

export interface CleanerEarningsViewProps {
  data: EarningsData;
  mounted: boolean;
  revealed: boolean;
  todayStr: string;
  /** The Container's <CleanerStripeConnect appearance=... /> element. Mounted only here. */
  embed: ReactNode;
  onSetup: () => void;
  onOpenStripe: () => void;
  dashboardLoading: boolean;
  openStripeError: string | null;
  error?: boolean;
  onRetry?: () => void;
}

function settleCopy(kind: ClearingSettleKind): string {
  if (kind === "ach") return "Expected, about 4 business days";
  if (kind === "card") return "Expected, settling";
  return "Expected";
}

export function CleanerEarningsView({
  data,
  mounted,
  revealed,
  todayStr,
  embed,
  onSetup,
  onOpenStripe,
  dashboardLoading,
  openStripeError,
  error,
  onRetry,
}: CleanerEarningsViewProps) {
  if (error) {
    return <ErrorState title="Couldn't load earnings" onRetry={onRetry} />;
  }
  if (data.mode === "employee") {
    return (
      <div className="space-y-4 py-2">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Landmark className="h-8 w-8 text-muted-foreground" />
            <p className="text-base font-semibold text-foreground">Your office handles your pay</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Your hours and pay are managed by your office. Reach out to them with any pay questions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const setUp = revealed || data.connectKind === "active";

  return (
    <div className="space-y-4 py-2">
      <PayoutTimingNotice />

      <PayoutsSection
        mode={data.mode}
        connectKind={data.connectKind}
        mounted={mounted}
        revealed={revealed}
        embed={embed}
        onSetup={onSetup}
        onOpenStripe={onOpenStripe}
        dashboardLoading={dashboardLoading}
        openStripeError={openStripeError}
        hasWaiting={data.clearing.length > 0}
      />

      {data.clearing.length > 0 && (
        <ClearingSection rows={data.clearing} todayStr={todayStr} setUp={setUp} />
      )}

      <ActivityTiles counts={data.counts} />
    </div>
  );
}

function PayoutsSection({
  mode,
  connectKind,
  mounted,
  revealed,
  embed,
  onSetup,
  onOpenStripe,
  dashboardLoading,
  openStripeError,
  hasWaiting,
}: {
  mode: EarningsData["mode"];
  connectKind: ConnectKind;
  mounted: boolean;
  revealed: boolean;
  embed: ReactNode;
  onSetup: () => void;
  onOpenStripe: () => void;
  dashboardLoading: boolean;
  openStripeError: string | null;
  hasWaiting: boolean;
}) {
  if (mode === "stripe-disabled") {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Payout setup isn&apos;t available yet.
        </CardContent>
      </Card>
    );
  }

  if (!revealed) {
    if (connectKind === "loading" || !mounted) {
      return <Skeleton className="h-44 w-full rounded-card" />;
    }
    return <EarningsSetupCard kind={connectKind} onSetup={onSetup} hasWaiting={hasWaiting} />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Payouts to your bank</CardTitle>
        {connectKind === "active" && (
          <Button variant="outline" size="sm" onClick={onOpenStripe} loading={dashboardLoading}>
            Open Stripe
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {openStripeError && (
          <p className="mb-3 text-sm font-medium text-destructive">{openStripeError}</p>
        )}
        {mounted ? embed : <Skeleton className="h-40 w-full rounded-card" />}
      </CardContent>
    </Card>
  );
}

function EarningsSetupCard({
  kind,
  onSetup,
  hasWaiting,
}: {
  kind: ConnectKind;
  onSetup: () => void;
  hasWaiting: boolean;
}) {
  const pending = kind === "pending";
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Landmark className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">
            {pending ? "Finish payout setup" : "Get paid for your work"}
          </p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {pending
              ? "You are almost there. Finish connecting your bank so we can send your payouts."
              : hasWaiting
                ? "Connect your bank account through Stripe to receive the money waiting below. Takes about 3 minutes."
                : "Connect your bank account through Stripe to receive your payouts. Takes about 3 minutes."}
          </p>
        </div>
        <Button onClick={onSetup} className="w-full">
          {pending ? "Finish setup" : "Set up payouts"}
        </Button>
        <p className="text-xs text-muted-foreground">Handled securely by Stripe.</p>
      </CardContent>
    </Card>
  );
}

function ClearingSection({
  rows,
  todayStr,
  setUp,
}: {
  rows: ClearingRow[];
  todayStr: string;
  setUp: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{setUp ? "Still clearing" : "Waiting for you"}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((r) => {
            const dateLabel = r.dateRaw ? formatCardDate(r.dateRaw, todayStr) : null;
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{r.serviceLabel}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.customerLabel}
                    {dateLabel ? ` · ${dateLabel}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <TxnStatusBadge badge="processing" />
                  <span className="tabular-nums text-sm font-semibold text-foreground">
                    {money2(r.cutDollars)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{settleCopy(r.settleKind)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {setUp
            ? "Moves into your Stripe payouts once the customer's payment clears."
            : "Connect your bank to receive this."}
        </p>
      </CardContent>
    </Card>
  );
}

function ActivityTiles({ counts }: { counts: EarningsData["counts"] }) {
  const tiles = [
    { label: "This week", value: counts.thisWeek },
    { label: "Completed", value: counts.completed },
    { label: "Upcoming", value: counts.upcoming },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="px-3 py-3 text-center">
            <p className="tabular-nums text-lg font-bold text-foreground">{t.value}</p>
            <p className="text-[11px] text-muted-foreground">{t.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
