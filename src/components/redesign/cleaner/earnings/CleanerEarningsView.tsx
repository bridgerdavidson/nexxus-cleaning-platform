// src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx
"use client";

import type { ReactNode } from "react";
import { Landmark, Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PayoutTimingNotice from "@/components/PayoutTimingNotice";
import { money2, PayoutStatusBadge, TxnStatusBadge } from "@/components/redesign/payments/payments-presenters";
import { formatCardDate } from "@/components/redesign/cleaner/shared/job-presenters";
import { ErrorState } from "@/components/ui/error-state";
import type {
  ClearingRow,
  ClearingSettleKind,
  ConnectKind,
  EarningsData,
  HeldKind,
  HeldPayoutRow,
} from "./earnings-types";

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

/** Row-level "why isn't this in my bank yet" copy. Depends on setup state, so it lives in the View. */
function heldReason(kind: HeldKind, setUp: boolean): string {
  if (kind === "failed") {
    return setUp ? "We'll retry this automatically." : "Finish payout setup to receive it.";
  }
  if (kind === "approved") return "Approved, sending to your bank.";
  return setUp ? "Sending to your bank soon." : "Waiting on your payout setup.";
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
  const owedLabel = data.owedDollars > 0 ? money2(data.owedDollars) : null;
  const failedRows = data.held.filter((r) => r.kind === "failed");
  const heldRows = data.held.filter((r) => r.kind !== "failed");
  const owedCount = data.held.length + data.clearing.length;

  return (
    <div className="space-y-4 py-2">
      {owedLabel && <OwedSummary owedLabel={owedLabel} count={owedCount} setUp={setUp} />}

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
        owedLabel={owedLabel}
      />

      {failedRows.length > 0 && (
        <PayoutBucketSection title="Needs attention" rows={failedRows} todayStr={todayStr} setUp={setUp} />
      )}

      {heldRows.length > 0 && (
        <PayoutBucketSection
          title="Held for you"
          rows={heldRows}
          todayStr={todayStr}
          setUp={setUp}
          footer={setUp ? undefined : "Sends to your bank once you connect an account."}
        />
      )}

      {data.clearing.length > 0 ? (
        <ClearingSection rows={data.clearing} todayStr={todayStr} setUp={setUp} />
      ) : data.held.length === 0 && setUp ? (
        <EmptyState
          icon={<Wallet />}
          title="No earnings yet"
          description="Once you complete a job, your pay shows up here."
        />
      ) : null}

      <ActivityTiles counts={data.counts} />
    </div>
  );
}

function OwedSummary({
  owedLabel,
  count,
  setUp,
}: {
  owedLabel: string;
  count: number;
  setUp: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm font-medium text-muted-foreground">You&apos;re owed</p>
        <p className="mt-0.5 tabular-nums text-3xl font-bold text-foreground">{owedLabel}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Across {count} {count === 1 ? "cleaning" : "cleanings"}.{" "}
          {setUp ? "Arriving in your bank as each one settles." : "Set up payouts to receive it."}
        </p>
      </CardContent>
    </Card>
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
  owedLabel,
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
  owedLabel: string | null;
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
    return <EarningsSetupCard kind={connectKind} onSetup={onSetup} owedLabel={owedLabel} />;
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
  owedLabel,
}: {
  kind: ConnectKind;
  onSetup: () => void;
  owedLabel: string | null;
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
              : owedLabel
                ? `Connect your bank account through Stripe to receive the ${owedLabel} waiting. Takes about 3 minutes.`
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

function PayoutBucketSection({
  title,
  rows,
  todayStr,
  setUp,
  footer,
}: {
  title: string;
  rows: HeldPayoutRow[];
  todayStr: string;
  setUp: boolean;
  footer?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((r) => {
            const dateLabel = r.dateRaw ? formatCardDate(r.dateRaw, todayStr) : null;
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{r.serviceLabel}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.customerLabel}
                      {dateLabel ? ` · ${dateLabel}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <PayoutStatusBadge badge={r.kind} />
                    <span className="tabular-nums text-sm font-semibold text-foreground">
                      {money2(r.amountDollars)}
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{heldReason(r.kind, setUp)}</p>
              </div>
            );
          })}
        </div>
        {footer ? <p className="px-4 py-3 text-xs text-muted-foreground">{footer}</p> : null}
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
