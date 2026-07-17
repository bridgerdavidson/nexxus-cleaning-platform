"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DisputedTag,
  PartialRefundTag,
  PayoutStatusBadge,
  SelfPayTag,
  TxnStatusBadge,
} from "./payments-presenters";
import type { PaymentLedger, PayoutRowVM, TransactionRowVM } from "./payments-types";

export type PaymentsTableProps = {
  ledger: PaymentLedger;
  txnRows: TransactionRowVM[];
  payoutRows: PayoutRowVM[];
  onOpenRow: (id: string) => void;
};

export function PaymentsTable({ ledger, txnRows, payoutRows, onOpenRow }: PaymentsTableProps) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            {ledger === "transactions" ? (
              <>
                <TableHead>Customer</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Method</TableHead>
              </>
            ) : (
              <TableHead>Cleaner</TableHead>
            )}
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ledger === "transactions"
            ? txnRows.map((r) => (
                <TableRow key={r.id} onClick={() => onOpenRow(r.id)} className="cursor-pointer">
                  <TableCell className="whitespace-nowrap text-sm text-foreground">{r.dateLabel}</TableCell>
                  <TableCell className="max-w-[18rem]">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-foreground">{r.payer}</span>
                      {r.selfPay ? <SelfPayTag /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.service}</TableCell>
                  <TableCell className="text-sm text-foreground">{r.method}</TableCell>
                  <TableCell className="text-right font-semibold tnum text-foreground">{r.amountLabel}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {r.disputed ? <DisputedTag /> : null}
                      {r.partiallyRefunded ? <PartialRefundTag /> : null}
                      <TxnStatusBadge badge={r.badge} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            : payoutRows.map((r) => (
                <TableRow key={r.id} onClick={() => onOpenRow(r.id)} className="cursor-pointer">
                  <TableCell className="whitespace-nowrap text-sm text-foreground">{r.dateLabel}</TableCell>
                  <TableCell className="max-w-[18rem]">
                    <span className="truncate font-semibold text-foreground">{r.cleaner}</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold tnum text-foreground">{r.amountLabel}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <PayoutStatusBadge badge={r.badge} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
