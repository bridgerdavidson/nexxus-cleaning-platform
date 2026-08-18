"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePaymentsTriage } from "./usePaymentsTriage";

/**
 * The Payments "Needs you now" triage band: failed charges, failed cleaner payouts,
 * and held payouts (cleaner not onboarded). Unlike the Overview queue it HIDES
 * entirely when empty, so its absence is the cockpit's "all clear". Owns its data
 * via usePaymentsTriage; actions map to real endpoints.
 */
export function PaymentsTriageBand({ canManagePayments }: { canManagePayments: boolean }) {
  const t = usePaymentsTriage();

  if (t.loading) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <h2 className="text-xl font-bold tracking-tight">Needs you now</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-control" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // Hide only when genuinely clean. A query error keeps the card so the error
  // message below renders instead of the band silently reading as "all clear" (T2-8).
  if (t.isEmpty && !t.error) return null;

  const total = t.charges.length + t.failedPayouts.length + t.heldPayouts.length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <h2 className="text-xl font-bold tracking-tight">Needs you now</h2>
        <Badge variant="secondary">{total > 99 ? "99+" : total}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {t.error ? <p className="text-sm text-critical-700">{t.error}</p> : null}
        {t.notice ? <p className="text-sm text-caution-700">{t.notice}</p> : null}

        {t.charges.length > 0 ? (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="critical">Failed charges</Badge>
              <Badge variant="secondary">{t.charges.length}</Badge>
            </div>
            <div className="space-y-2">
              {t.charges.map((c) => (
                <div
                  key={c.apptId}
                  className="flex flex-col gap-3 rounded-control border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {c.payer} · {c.amountLabel}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.dateLabel} ·{" "}
                      {c.reason === "failed"
                        ? "Card charge failed"
                        : "Customer needs to verify their identity (3D Secure)"}
                    </p>
                  </div>
                  {canManagePayments ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" onClick={() => t.fixCard(c.apptId)}>
                        Fix card
                      </Button>
                      {c.canSendLink ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={t.busyId === c.apptId}
                          onClick={() => t.sendCardLink(c.apptId, c.homeownerId, c.payer)}
                        >
                          Send card link
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {t.failedPayouts.length > 0 ? (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="critical">Failed payouts</Badge>
              <Badge variant="secondary">{t.failedPayouts.length}</Badge>
            </div>
            <div className="space-y-2">
              {t.failedPayouts.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col gap-3 rounded-control border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {p.cleaner} · {p.amountLabel}
                      </p>
                      {p.resurfaced ? (
                        <Badge variant="caution" className="shrink-0">
                          Still failing
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.resurfaced
                        ? `You snoozed this on ${p.dismissedDateLabel}. It has kept failing since.`
                        : canManagePayments
                          ? "Transfer to the cleaner failed. Retry now, or snooze it for a day."
                          : "Transfer to the cleaner failed. It retries automatically on the next sweep."}
                    </p>
                  </div>
                  {canManagePayments ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        loading={t.busyId === p.id && t.busyAction === "retry"}
                        disabled={t.busyId === p.id}
                        onClick={() => t.retryPayout(p.id)}
                      >
                        Retry now
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={t.busyId === p.id && t.busyAction === "dismiss"}
                        disabled={t.busyId === p.id}
                        onClick={() => t.dismissPayout(p.id)}
                      >
                        {p.resurfaced ? "Snooze again" : "Snooze"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {t.heldPayouts.length > 0 ? (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="caution">Queued payouts</Badge>
              <Badge variant="secondary">{t.heldPayouts.length}</Badge>
            </div>
            <div className="space-y-2">
              {t.heldPayouts.map((h) => (
                <div
                  key={h.cleanerId ?? h.cleaner}
                  className="flex flex-col gap-3 rounded-control border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {h.amountLabel} queued
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {h.cleaner} hasn&apos;t finished payout setup. The payment sends automatically once they do.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => t.messageCleaner(h.cleanerId)}>
                      Message {h.cleaner}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
