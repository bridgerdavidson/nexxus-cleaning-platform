"use client";

import { PayoutStatusBadge, SelfPayTag, TxnStatusBadge } from "./payments-presenters";
import type { PaymentLedger, PayoutRowVM, TransactionRowVM } from "./payments-types";

const cardClass =
  "flex w-full items-center justify-between gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type PaymentsCardListProps = {
  ledger: PaymentLedger;
  txnRows: TransactionRowVM[];
  payoutRows: PayoutRowVM[];
  onOpenRow: (id: string) => void;
};

export function PaymentsCardList({ ledger, txnRows, payoutRows, onOpenRow }: PaymentsCardListProps) {
  return (
    <div className="space-y-3">
      {ledger === "transactions"
        ? txnRows.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpenRow(r.id)} className={cardClass}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{r.payer}</span>
                  {r.selfPay ? <SelfPayTag /> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {r.dateLabel} · {r.service} · {r.method}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold tnum text-foreground">{r.amountLabel}</span>
                <TxnStatusBadge badge={r.badge} />
              </div>
            </button>
          ))
        : payoutRows.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpenRow(r.id)} className={cardClass}>
              <div className="min-w-0">
                <span className="block truncate font-semibold text-foreground">{r.cleaner}</span>
                <p className="truncate text-xs text-muted-foreground">{r.dateLabel}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold tnum text-foreground">{r.amountLabel}</span>
                <PayoutStatusBadge badge={r.badge} />
              </div>
            </button>
          ))}
    </div>
  );
}
