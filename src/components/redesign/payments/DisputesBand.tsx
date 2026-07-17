"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminDisputes } from "@/hooks/useAdminData";
import { useAuth } from "@/hooks/useAuth";
import { DisputeStatusBadge, DisputeDeadlinePill } from "./payments-presenters";
import { DisputeDetailSheet } from "./DisputeDetailSheet";
import { openDisputes, toDisputeRow, toDisputeDetail } from "./deriveDisputes";

/**
 * The Payments disputes (chargebacks) band. Lists OPEN disputes soonest-deadline
 * first with the evidence-response window front and center, so a chargeback the
 * `dispute_opened` bell only mentions once is now visible, contextual, and
 * deadline-aware right where the bell lands. Terminal disputes drop off. Hides
 * when there are none, but a query FAILURE surfaces (never reads as "all clear").
 */
export function DisputesBand() {
  const router = useRouter();
  const { currentOrganization } = useAuth();
  const { disputes, loading, error } = useAdminDisputes();
  const orgName = currentOrganization?.name || "Your company";

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Deadlines are day-granular, so a render-time clock is precise enough.
  const now = Date.now();
  const rows = openDisputes(disputes).map((d) => toDisputeRow(d, orgName, now));
  const selectedRaw = selectedId ? disputes.find((x) => x.id === selectedId) : null;
  const selected = selectedRaw ? toDisputeDetail(selectedRaw, orgName, now) : null;

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <h2 className="text-xl font-bold tracking-tight">Disputes</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-control" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // A failed query must not read as "no disputes" (T2-8 lesson): surface it.
  if (error) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <h2 className="text-xl font-bold tracking-tight">Disputes</h2>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-critical-700">
            Couldn&apos;t load disputes. Refresh to try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  // No open disputes: hide entirely, like the triage band's "all clear".
  if (rows.length === 0) return null;

  const handleMessage = (homeownerId: string) => {
    router.push(`/app/admin-dashboard/messages?to=${homeownerId}`);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <h2 className="text-xl font-bold tracking-tight">Disputes</h2>
          <Badge variant="critical">{rows.length > 99 ? "99+" : rows.length}</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className="flex w-full flex-col gap-2 rounded-control border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {r.payer} · <span className="tnum">{r.amountLabel}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.service} · {r.reason} · opened {r.openedLabel}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <DisputeDeadlinePill urgency={r.urgency} dueLabel={r.deadlineLabel} />
                <DisputeStatusBadge badge={r.badge} />
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <DisputeDetailSheet
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        dispute={selected}
        onMessageCustomer={handleMessage}
      />
    </>
  );
}
