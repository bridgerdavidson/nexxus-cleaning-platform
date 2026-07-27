"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money2 } from "./payments-presenters";
import { marginLine, type MarginTone } from "./payRequestMath";
import { usePayRequests, type PayRequestVM } from "./usePayRequests";
import { PayRequestDetailSheet } from "./PayRequestDetailSheet";

/**
 * The Payments "Pay requests" band: open negotiation threads for request-mode
 * cleaners. "Waiting on you" rows carry the actions (Approve as-is, or Review
 * to counter in the detail sheet); "Waiting on cleaner" rows are awareness
 * until the cleaner responds. Hides entirely when there are no open threads,
 * like the triage band, but a query FAILURE surfaces (never reads as all-clear).
 */
export function PayRequestsBand({ canManagePayments }: { canManagePayments: boolean }) {
  const q = usePayRequests();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (q.loading) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <h2 className="text-xl font-bold tracking-tight">Pay requests</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-control" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (q.isEmpty && !q.error) return null;

  const total = q.waitingOnYou.length + q.waitingOnCleaner.length;
  const selected =
    [...q.waitingOnYou, ...q.waitingOnCleaner].find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <h2 className="text-xl font-bold tracking-tight">Pay requests</h2>
          <Badge variant="secondary">{total > 99 ? "99+" : total}</Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          {q.error ? (
            <p role="alert" className="text-sm text-critical-700">
              Couldn&apos;t load pay requests. Refresh to try again.
            </p>
          ) : null}

          {q.waitingOnYou.length > 0 ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="caution">Waiting on you</Badge>
                <Badge variant="secondary">{q.waitingOnYou.length}</Badge>
              </div>
              <div className="space-y-2">
                {q.waitingOnYou.map((r) => (
                  <PayRequestRow
                    key={r.id}
                    row={r}
                    onOpen={() => setSelectedId(r.id)}
                    actions={
                      canManagePayments ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            loading={q.busyId === r.id}
                            onClick={() => void q.approve(r.id, r.latestAmountCents)}
                          >
                            Approve {money2(r.latestAmountCents / 100)}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={q.busyId === r.id}
                            onClick={() => setSelectedId(r.id)}
                          >
                            Review
                          </Button>
                        </div>
                      ) : null
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}

          {q.waitingOnCleaner.length > 0 ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="secondary">Waiting on cleaner</Badge>
                <Badge variant="secondary">{q.waitingOnCleaner.length}</Badge>
              </div>
              <div className="space-y-2">
                {q.waitingOnCleaner.map((r) => (
                  <PayRequestRow key={r.id} row={r} onOpen={() => setSelectedId(r.id)} />
                ))}
              </div>
            </section>
          ) : null}
        </CardContent>
      </Card>

      <PayRequestDetailSheet
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        request={selected}
        canManagePayments={canManagePayments}
        busy={!!selected && q.busyId === selected.id}
        onApprove={q.approve}
        onCounter={q.counter}
      />
    </>
  );
}

const MARGIN_TONE_CLASS: Record<MarginTone, string> = {
  positive: "text-positive-700",
  caution: "text-caution-700",
  critical: "text-critical-700",
};

function PayRequestRow({
  row,
  onOpen,
  actions,
}: {
  row: PayRequestVM;
  onOpen: () => void;
  actions?: React.ReactNode;
}) {
  const margin = marginLine(row);
  const askLabel =
    row.latestActor === "cleaner"
      ? `asked ${money2(row.latestAmountCents / 100)}`
      : `${row.latestIsCounter ? "your counter" : "your offer"} ${money2(row.latestAmountCents / 100)}`;
  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="truncate text-sm font-semibold text-foreground">
          {row.cleaner} · <span className="tnum">{askLabel}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {row.jobLabel}
          {row.dateLabel ? ` · ${row.dateLabel}` : ""} · job price{" "}
          <span className="tnum">{money2(row.jobPriceCents / 100)}</span> ·{" "}
          <span className={MARGIN_TONE_CLASS[margin.tone]}>{margin.text}</span> · {row.ageLabel}
        </p>
      </button>
      {actions}
    </div>
  );
}
