"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { useToast } from "@/contexts/ToastContext";
import { useStartConversation } from "@/hooks/useStartConversation";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useAdminPayments,
  useAdminPayouts,
  usePaymentStats,
  type AdminPayment,
  type AdminPayout,
} from "@/hooks/useAdminData";
import { deriveTransactions, derivePayouts } from "./derivePayments";
import { deriveTransactionBadge, derivePayoutBadge } from "./derivePaymentsBadges";
import { longDate, methodLabel, money2 } from "./payments-presenters";
import { OperatorPaymentsView } from "./OperatorPaymentsView";
import { PaymentsTriageBand } from "./PaymentsTriageBand";
import { PaymentsMoneyGlance } from "./PaymentsMoneyGlance";
import { PaymentsYourMoney } from "./PaymentsYourMoney";
import { PaymentDetailSheet } from "./PaymentDetailSheet";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import type {
  PaymentLedger,
  PaymentSort,
  PayoutDetailVM,
  PayoutRowVM,
  PayoutStatusFilter,
  TransactionDetailVM,
  TransactionRowVM,
  TxnStatusFilter,
} from "./payments-types";

// --- AdminPayment / AdminPayout -> view-model mappers ---

function fullName(p: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!p) return "";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

function payerOf(p: AdminPayment, orgName: string): { payer: string; selfPay: boolean } {
  const name = fullName(p.appointment?.homeowner);
  const selfPay = !!p.is_self_pay;
  if (name) return { payer: name, selfPay };
  if (selfPay) return { payer: orgName, selfPay: true };
  return { payer: "Customer", selfPay: false };
}

function toTxnRow(p: AdminPayment, orgName: string): TransactionRowVM {
  const { payer, selfPay } = payerOf(p, orgName);
  return {
    id: p.id,
    dateLabel: longDate(p.appointment?.scheduled_date || p.created_at),
    payer,
    selfPay,
    service: p.appointment?.service_type?.name || "Cleaning",
    amountLabel: money2(p.amount),
    method: methodLabel(p.payment_method),
    badge: deriveTransactionBadge(p.status),
  };
}

function toPayoutRow(p: AdminPayout): PayoutRowVM {
  return {
    id: p.id,
    dateLabel: longDate(p.created_at),
    cleaner: fullName(p.cleaner) || "Cleaner",
    amountLabel: money2(p.amount),
    badge: derivePayoutBadge(p.status),
  };
}

/**
 * Permission gate for the Operator Payments screen. Payment data (revenue, payouts,
 * the org's Stripe balance) is an APP-LEVEL grant, not RLS, so we must not mount the
 * data component (and its hooks) until we know the viewer is allowed. The whole
 * screen is money, so can_view_payments gates all of it (no partial "list but not
 * figures" tier). useManagerPermissions returns ALL_FALSE for admins, so check role
 * first.
 */
export function OperatorPayments() {
  const { currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canView = privileged || !!permissions?.can_view_payments;

  if (!privileged && permsLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canView) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <EmptyState
          icon={<ShieldAlert />}
          title="You do not have access to payments"
          description="Ask an owner or admin to grant you the payments permission."
        />
      </div>
    );
  }

  return (
    <OperatorPaymentsData
      canManagePayments={privileged || !!permissions?.can_manage_payments}
      canRefund={privileged}
    />
  );
}

function OperatorPaymentsData({
  canManagePayments,
  canRefund,
}: {
  canManagePayments: boolean;
  canRefund: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrganizationId, currentOrganization } = useAuth();
  const { showToast } = useToast();
  const { startConversation } = useStartConversation();

  const { payments, loading: paymentsLoading, refetch: refetchPayments } = useAdminPayments();
  const { payouts, loading: payoutsLoading, refetch: refetchPayouts } = useAdminPayouts();
  const { stats, loading: statsLoading } = usePaymentStats();

  const orgName = currentOrganization?.name || "Your company";
  const ledger: PaymentLedger = searchParams.get("ledger") === "payouts" ? "payouts" : "transactions";

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PaymentSort>("recent");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const setLedger = useCallback(
    (l: PaymentLedger) => {
      const params = new URLSearchParams(searchParams.toString());
      if (l === "payouts") params.set("ledger", "payouts");
      else params.delete("ledger");
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  // Switching ledgers clears the search, status filter, and any open row so a
  // transaction's status never lingers as a payouts filter and vice-versa.
  useEffect(() => {
    setSearch("");
    setStatusFilter("all");
    setSelectedRowId(null);
  }, [ledger]);

  const txnRows = useMemo<TransactionRowVM[]>(() => {
    if (ledger !== "transactions") return [];
    return deriveTransactions(payments, {
      search,
      statusFilter: statusFilter as TxnStatusFilter,
      sort,
      orgName,
    }).map((p) => toTxnRow(p, orgName));
  }, [ledger, payments, search, statusFilter, sort, orgName]);

  const payoutRows = useMemo<PayoutRowVM[]>(() => {
    if (ledger !== "payouts") return [];
    return derivePayouts(payouts, {
      search,
      statusFilter: statusFilter as PayoutStatusFilter,
      sort,
    }).map(toPayoutRow);
  }, [ledger, payouts, search, statusFilter, sort]);

  const txnDetail = useMemo<TransactionDetailVM | null>(() => {
    if (ledger !== "transactions" || !selectedRowId) return null;
    const p = payments.find((x) => x.id === selectedRowId);
    if (!p) return null;
    const { payer, selfPay } = payerOf(p, orgName);
    return {
      id: p.id,
      dateLabel: longDate(p.appointment?.scheduled_date || p.created_at),
      payer,
      selfPay,
      service: p.appointment?.service_type?.name || "Cleaning",
      amountLabel: money2(p.amount),
      method: methodLabel(p.payment_method),
      badge: deriveTransactionBadge(p.status),
      reference: p.reference ?? null,
      notes: p.notes ?? null,
      createdLabel: longDate(p.created_at),
      paidLabel: p.paid_at ? longDate(p.paid_at) : null,
      refundable: canRefund && p.status === "paid" && p.payment_method === "card",
    };
  }, [ledger, selectedRowId, payments, orgName, canRefund]);

  const payoutDetail = useMemo<PayoutDetailVM | null>(() => {
    if (ledger !== "payouts" || !selectedRowId) return null;
    const p = payouts.find((x) => x.id === selectedRowId);
    if (!p) return null;
    return {
      id: p.id,
      dateLabel: longDate(p.created_at),
      cleaner: fullName(p.cleaner) || "Cleaner",
      amountLabel: money2(p.amount),
      badge: derivePayoutBadge(p.status),
      cleanerId: p.cleaner_id ?? null,
      appointmentId: p.appointment?.id ?? null,
      notes: p.notes ?? null,
      createdLabel: longDate(p.created_at),
      approvedLabel: p.approved_at ? longDate(p.approved_at) : null,
      paidLabel: p.paid_at ? longDate(p.paid_at) : null,
      rawStatus: p.status,
    };
  }, [ledger, selectedRowId, payouts]);

  const sheetOpen = !!txnDetail || !!payoutDetail;

  const authHeaders = useCallback(async () => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const handleRefund = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/payments/${id}/refund`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ organization_id: currentOrganizationId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Refund failed");
        showToast(data.fully_refunded ? "Payment refunded" : "Partial refund issued", {
          variant: "success",
        });
        await refetchPayments();
        setSelectedRowId(null);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Refund failed", { variant: "error" });
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, showToast, refetchPayments],
  );

  const handleRetry = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/payouts/${id}/retry`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ organization_id: currentOrganizationId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Retry failed");
        showToast(
          data.reason === "cleaner_slice_held"
            ? "Queued. It sends once the cleaner finishes payout setup."
            : "Payout retried",
          { variant: "success" },
        );
        await refetchPayouts();
        setSelectedRowId(null);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Retry failed", { variant: "error" });
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, showToast, refetchPayouts],
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/payouts/${id}/dismiss`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ organization_id: currentOrganizationId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not dismiss");
        showToast("Dismissed", { variant: "success" });
        await refetchPayouts();
        setSelectedRowId(null);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Could not dismiss", { variant: "error" });
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, showToast, refetchPayouts],
  );

  const handleMessage = useCallback(
    async (cleanerId: string | null) => {
      if (cleanerId) await startConversation(cleanerId);
      router.push("/admin-dashboard?tab=messages");
    },
    [router, startConversation],
  );

  return (
    <>
      <OperatorPaymentsView
        loading={paymentsLoading || payoutsLoading}
        ledger={ledger}
        onLedgerChange={setLedger}
        txnRows={txnRows}
        payoutRows={payoutRows}
        txnTotal={payments.length}
        payoutTotal={payouts.length}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onOpenRow={setSelectedRowId}
        canManagePayments={canManagePayments}
        onRecordPayment={() => setRecordOpen(true)}
        triage={<PaymentsTriageBand canManagePayments={canManagePayments} />}
        moneyGlance={
          <PaymentsMoneyGlance
            totalRevenue={stats?.totalRevenue ?? 0}
            thisMonth={stats?.thisMonthRevenue ?? 0}
            queuedPayouts={stats?.pendingPayouts ?? 0}
            loading={statsLoading}
          />
        }
        yourMoney={canManagePayments ? <PaymentsYourMoney /> : undefined}
      />

      <PaymentDetailSheet
        open={sheetOpen}
        onOpenChange={(o) => {
          if (!o) setSelectedRowId(null);
        }}
        kind={ledger}
        txn={txnDetail}
        payout={payoutDetail}
        canManagePayments={canManagePayments}
        busy={busy}
        onRefund={handleRefund}
        onRetry={handleRetry}
        onDismiss={handleDismiss}
        onMessage={handleMessage}
      />

      <RecordPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        onRecorded={() => {
          void refetchPayments();
        }}
      />
    </>
  );
}
