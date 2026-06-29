"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorPaymentsView } from "@/components/redesign/payments/OperatorPaymentsView";
import { PaymentsKpiStrip } from "@/components/redesign/payments/PaymentsKpiStrip";
import { PaymentDetailSheet } from "@/components/redesign/payments/PaymentDetailSheet";
import type {
  PaymentLedger,
  PaymentSort,
  PayoutDetailVM,
  PayoutRowVM,
  TransactionDetailVM,
  TransactionRowVM,
} from "@/components/redesign/payments/payments-types";

// TEMPORARY dev-only preview (gated by the (dev) layout) so the presentational
// Payments View + detail Sheet can be iterated on without auth/hooks. The triage
// band and the Stripe embed are hook-backed, so they are shown here as static
// mocks. The live screen is at /app/admin-dashboard/payments.

const TXN_ROWS: TransactionRowVM[] = [
  { id: "t1", dateLabel: "Jun 20, 2026", payer: "Jane Smith", selfPay: false, service: "Deep clean", amountLabel: "$240.00", method: "Card", badge: "paid" },
  { id: "t2", dateLabel: "Jun 19, 2026", payer: "Acme Cleaning Co", selfPay: true, service: "Standard clean", amountLabel: "$120.00", method: "Card", badge: "processing" },
  { id: "t3", dateLabel: "Jun 18, 2026", payer: "Nadia Patel", selfPay: false, service: "Move-out clean", amountLabel: "$310.00", method: "ACH", badge: "refunded" },
  { id: "t4", dateLabel: "Jun 17, 2026", payer: "Aaron Lee", selfPay: false, service: "Standard clean", amountLabel: "$95.00", method: "Manual", badge: "pending" },
  { id: "t5", dateLabel: "Jun 16, 2026", payer: "Marcus Webb", selfPay: false, service: "Deep clean", amountLabel: "$220.00", method: "Card", badge: "failed" },
];

const PAYOUT_ROWS: PayoutRowVM[] = [
  { id: "p1", dateLabel: "Jun 20, 2026", cleaner: "Wanda Cole", amountLabel: "$96.00", badge: "paid" },
  { id: "p2", dateLabel: "Jun 19, 2026", cleaner: "Bob Lee", amountLabel: "$48.00", badge: "held" },
  { id: "p3", dateLabel: "Jun 18, 2026", cleaner: "Wanda Cole", amountLabel: "$80.00", badge: "failed" },
  { id: "p4", dateLabel: "Jun 12, 2026", cleaner: "Priya Shah", amountLabel: "$132.00", badge: "reversed" },
];

const TXN_DETAILS: Record<string, TransactionDetailVM> = {
  t1: { ...TXN_ROWS[0], reference: "AP-1042", notes: "Paid in full at completion.", createdLabel: "Jun 20, 2026", paidLabel: "Jun 20, 2026", refundable: true },
  t2: { ...TXN_ROWS[1], reference: null, notes: "Company self-pay.", createdLabel: "Jun 19, 2026", paidLabel: null, refundable: false },
  t3: { ...TXN_ROWS[2], reference: "AP-1031", notes: null, createdLabel: "Jun 18, 2026", paidLabel: "Jun 18, 2026", refundable: false },
  t4: { ...TXN_ROWS[3], reference: null, notes: "Cash on site.", createdLabel: "Jun 17, 2026", paidLabel: null, refundable: false },
  t5: { ...TXN_ROWS[4], reference: null, notes: null, createdLabel: "Jun 16, 2026", paidLabel: null, refundable: false },
};

const PAYOUT_DETAILS: Record<string, PayoutDetailVM> = {
  p1: { ...PAYOUT_ROWS[0], cleanerId: "c1", appointmentId: "a1", notes: null, createdLabel: "Jun 20, 2026", approvedLabel: "Jun 20, 2026", paidLabel: "Jun 20, 2026", rawStatus: "paid" },
  p2: { ...PAYOUT_ROWS[1], cleanerId: "c2", appointmentId: "a2", notes: null, createdLabel: "Jun 19, 2026", approvedLabel: null, paidLabel: null, rawStatus: "pending" },
  p3: { ...PAYOUT_ROWS[2], cleanerId: "c1", appointmentId: "a3", notes: "Transfer bounced.", createdLabel: "Jun 18, 2026", approvedLabel: null, paidLabel: null, rawStatus: "failed" },
  p4: { ...PAYOUT_ROWS[3], cleanerId: "c3", appointmentId: "a4", notes: "Refund clawback.", createdLabel: "Jun 12, 2026", approvedLabel: "Jun 12, 2026", paidLabel: "Jun 12, 2026", rawStatus: "reversed" },
};

function MockTriageBand() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <h2 className="text-xl font-bold tracking-tight">Needs you now</h2>
        <Badge variant="secondary">3</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="critical">Failed charges</Badge>
            <Badge variant="secondary">1</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-card p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Marcus Webb · $220.00</p>
              <p className="text-xs text-muted-foreground">Jun 16, 2026 · Card charge failed</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm">Fix card</Button>
              <Button size="sm" variant="secondary">Copy card link</Button>
            </div>
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="caution">Queued payouts</Badge>
            <Badge variant="secondary">1</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-card p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">$48.00 queued</p>
              <p className="text-xs text-muted-foreground">Bob Lee hasn&apos;t finished payout setup.</p>
            </div>
            <Button size="sm" variant="secondary">Message Bob Lee</Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function MockYourMoney() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your money</CardTitle>
        <CardDescription>
          {"Your Stripe balance, the next payout on its way, and what's already landed in your bank."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid min-h-[160px] place-items-center rounded-card border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
          Stripe payouts embed renders on the live screen.
        </div>
      </CardContent>
    </Card>
  );
}

export default function PaymentsPreviewPage() {
  const [ledger, setLedger] = useState<PaymentLedger>("transactions");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PaymentSort>("recent");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const txn = selectedRowId && ledger === "transactions" ? TXN_DETAILS[selectedRowId] ?? null : null;
  const payout = selectedRowId && ledger === "payouts" ? PAYOUT_DETAILS[selectedRowId] ?? null : null;

  return (
    <OperatorShell active="payments" onNewBooking={() => {}}>
      <OperatorPaymentsView
        ledger={ledger}
        onLedgerChange={(l) => {
          setLedger(l);
          setSelectedRowId(null);
          setStatusFilter("all");
        }}
        txnRows={TXN_ROWS}
        payoutRows={PAYOUT_ROWS}
        txnTotal={TXN_ROWS.length}
        payoutTotal={PAYOUT_ROWS.length}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onOpenRow={setSelectedRowId}
        canManagePayments
        onRecordPayment={() => {}}
        triage={<MockTriageBand />}
        kpis={<PaymentsKpiStrip totalRevenue={12480} thisMonth={3210} />}
        yourMoney={<MockYourMoney />}
      />

      <PaymentDetailSheet
        open={!!txn || !!payout}
        onOpenChange={(o) => {
          if (!o) setSelectedRowId(null);
        }}
        kind={ledger}
        txn={txn}
        payout={payout}
        canManagePayments
        busy={false}
        onRefund={() => {}}
        onRetry={() => {}}
        onDismiss={() => {}}
        onMessage={() => {}}
      />
    </OperatorShell>
  );
}
