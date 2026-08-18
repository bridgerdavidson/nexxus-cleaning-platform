"use client";

import type { ReactNode } from "react";
import { Plus, Search, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PaymentsTable } from "./PaymentsTable";
import { PaymentsCardList } from "./PaymentsCardList";
import { PAYMENT_SORTS, PAYOUT_STATUS_FILTERS, TXN_STATUS_FILTERS } from "./payments-types";
import type { PaymentLedger, PaymentSort, PayoutRowVM, TransactionRowVM } from "./payments-types";

const LEDGER_OPTIONS: { value: PaymentLedger; label: string }[] = [
  { value: "transactions", label: "Transactions" },
  { value: "payouts", label: "Payouts" },
];

function LedgerSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-soft-sm"
        >
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="hidden h-7 w-24 sm:block" />
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

export type OperatorPaymentsViewProps = {
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  ledger: PaymentLedger;
  onLedgerChange: (l: PaymentLedger) => void;
  txnRows: TransactionRowVM[];
  payoutRows: PayoutRowVM[];
  txnTotal: number;
  payoutTotal: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;

  search: string;
  onSearchChange: (v: string) => void;
  sort: PaymentSort;
  onSortChange: (v: PaymentSort) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;

  onOpenRow: (id: string) => void;
  canManagePayments: boolean;
  onRecordPayment?: () => void;

  disputesBand?: ReactNode;
  triage?: ReactNode;
  payRequests?: ReactNode;
  kpis?: ReactNode;
  yourMoney?: ReactNode;
};

export function OperatorPaymentsView({
  loading,
  error,
  onRetry,
  ledger,
  onLedgerChange,
  txnRows,
  payoutRows,
  txnTotal,
  payoutTotal,
  hasMore,
  onLoadMore,
  loadingMore,
  search,
  onSearchChange,
  sort,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
  onOpenRow,
  canManagePayments,
  onRecordPayment,
  disputesBand,
  triage,
  payRequests,
  kpis,
  yourMoney,
}: OperatorPaymentsViewProps) {
  if (error) {
    return <ErrorState title="Couldn't load payments" onRetry={onRetry} />;
  }
  const isTxn = ledger === "transactions";
  const rowsLen = isTxn ? txnRows.length : payoutRows.length;
  const activeTotal = isTxn ? txnTotal : payoutTotal;
  const statusOptions = isTxn ? TXN_STATUS_FILTERS : PAYOUT_STATUS_FILTERS;
  const filtersActive = !!search || statusFilter !== "all";
  const noun = isTxn ? "transaction" : "payout";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Payments</h1>
        {canManagePayments && onRecordPayment ? (
          <Button onClick={onRecordPayment} className="shrink-0">
            <Plus /> Record payment
          </Button>
        ) : null}
      </header>

      {disputesBand}
      {triage}
      {payRequests}
      {kpis}
      {yourMoney}

      <div className="space-y-4">
        <SegmentedControl options={LEDGER_OPTIONS} value={ledger} onChange={onLedgerChange} />

        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
          <div className="relative col-span-2 sm:flex-1 sm:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={isTxn ? "Search by customer, reference, or service" : "Search by cleaner"}
              className="pl-10"
              aria-label="Search payments"
            />
          </div>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-full sm:w-44 sm:shrink-0" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => onSortChange(v as PaymentSort)}>
            <SelectTrigger className="w-full sm:w-40 sm:shrink-0" aria-label="Sort payments">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <LedgerSkeleton />
        ) : rowsLen === 0 ? (
          <EmptyState
            icon={<Wallet />}
            title={
              activeTotal === 0
                ? `No ${noun}s yet`
                : filtersActive && hasMore
                  ? `No matches in the loaded ${noun}s`
                  : `No ${noun}s match your filters`
            }
            description={
              activeTotal === 0
                ? isTxn
                  ? "Charges and refunds will show up here."
                  : "Cleaner payouts will show up here."
                : filtersActive && hasMore
                  ? `Load more to search older ${noun}s.`
                  : "Try a different search or status."
            }
            action={
              filtersActive && hasMore ? (
                <Button variant="secondary" onClick={onLoadMore} loading={loadingMore}>
                  Load more {noun}s to search
                </Button>
              ) : filtersActive ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onSearchChange("");
                    onStatusFilterChange("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <PaymentsTable
                ledger={ledger}
                txnRows={txnRows}
                payoutRows={payoutRows}
                onOpenRow={onOpenRow}
              />
            </div>
            <div className="lg:hidden">
              <PaymentsCardList
                ledger={ledger}
                txnRows={txnRows}
                payoutRows={payoutRows}
                onOpenRow={onOpenRow}
              />
            </div>
            {hasMore ? (
              <div className="flex justify-center pt-2">
                <Button variant="secondary" onClick={onLoadMore} loading={loadingMore}>
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
