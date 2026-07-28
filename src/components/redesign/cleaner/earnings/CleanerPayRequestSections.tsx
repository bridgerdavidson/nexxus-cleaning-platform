// src/components/redesign/cleaner/earnings/CleanerPayRequestSections.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/useAuth";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { money2 } from "@/components/redesign/payments/payments-presenters";
import { useCleanerPayRequests } from "@/hooks/useCleanerPayRequests";
import { derivePayRequests, type PayRequestRow } from "./derivePayRequests";
import { PayRequestThreadSheet } from "./PayRequestThreadSheet";

/**
 * The request-mode cleaner's open pay negotiations on the Earnings screen.
 *
 * Two buckets: "Waiting on you" (the org countered; tap to accept or counter
 * back) comes first because it is the only one they can act on, then
 * "Awaiting approval" (their ask is with the org). Both hide when empty, so a
 * percentage-mode cleaner never sees this at all.
 */
export function CleanerPayRequestSections() {
  const { currentOrganizationId } = useAuth();
  const { threads, loading, error, refetch } = useCleanerPayRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Day-scale queue, so a render-time clock is precise enough.
  const buckets = useMemo(() => derivePayRequests(threads, Date.now()), [threads]);
  const selected = threads.find((t) => t.id === openId) ?? null;

  const respond = useCallback(
    async (payRequestId: string, body: Record<string, unknown>): Promise<boolean> => {
      if (!currentOrganizationId) return false;
      setBusy(true);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/pay-requests/${payRequestId}/respond`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ organization_id: currentOrganizationId, ...body }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
        if (!res.ok) {
          toast.error(data.error || "Could not send that. Try again.");
          return false;
        }
        toast.success(
          data.status === "approved" ? "Agreed. Your pay is on its way." : "Sent to your company.",
        );
        return true;
      } catch {
        toast.error("Could not send that. Try again.");
        return false;
      } finally {
        setBusy(false);
        void refetch();
      }
    },
    [currentOrganizationId, refetch],
  );

  const onAccept = useCallback(
    (id: string) => respond(id, { accept: true }),
    [respond],
  );
  const onCounter = useCallback(
    (id: string, amountCents: number, note: string | null) =>
      respond(id, { amount_cents: amountCents, ...(note ? { note } : {}) }),
    [respond],
  );

  // A failed load must not read as "nothing pending" when real money is
  // waiting on them, so surface it (the payments-band rule).
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pay requests</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-critical-700">
            Couldn&apos;t load your pay requests.
          </p>
          <Button
            variant="outline"
            className="mt-3 min-h-[44px]"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isEmpty =
    buckets.awaiting.length === 0 && buckets.yourTurn.length === 0 && buckets.agreed.length === 0;
  if (loading || isEmpty) return null;

  return (
    <>
      {buckets.yourTurn.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Waiting on you</CardTitle>
            <Badge variant="caution">{buckets.yourTurn.length}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {buckets.yourTurn.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  className="flex w-full min-h-[44px] items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RowText row={r} subtitle="They offered a different amount. Tap to respond." />
                  <span className="shrink-0 tabular-nums text-sm font-semibold text-foreground">
                    {money2(r.amountCents / 100)}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {buckets.awaiting.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Awaiting approval</CardTitle>
            <Badge variant="secondary">{buckets.awaiting.length}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {buckets.awaiting.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <RowText row={r} subtitle="Your company is reviewing this." />
                    <span className="shrink-0 tabular-nums text-sm font-semibold text-foreground">
                      {money2(r.amountCents / 100)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {buckets.agreed.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Agreed</CardTitle>
            <Badge variant="positive">{buckets.agreed.length}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {buckets.agreed.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <RowText row={r} subtitle="Agreed. Being sent to your bank." />
                    <span className="shrink-0 tabular-nums text-sm font-semibold text-foreground">
                      {money2(r.amountCents / 100)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <PayRequestThreadSheet
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
        thread={selected}
        busy={busy}
        onAccept={onAccept}
        onCounter={onCounter}
      />
    </>
  );
}

function RowText({ row, subtitle }: { row: PayRequestRow; subtitle: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-foreground">
        {row.propertyLabel ?? row.jobLabel}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {subtitle} · {row.ageLabel}
      </p>
    </div>
  );
}
