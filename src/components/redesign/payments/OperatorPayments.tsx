"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { replaceSearchShallow } from "@/lib/shallowSearch";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert } from "lucide-react";
import { keys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { toast } from "@/components/ui/toast";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useAdminPaymentsInfinite,
  useAdminPayoutsInfinite,
  usePaymentStats,
  useAdminDisputes,
  type AdminPayment,
  type AdminPayout,
} from "@/hooks/useAdminData";
import { deriveTransactions, derivePayouts } from "./derivePayments";
import { deriveTransactionBadge, derivePayoutBadge } from "./derivePaymentsBadges";
import { openDisputedPaymentIds } from "./deriveDisputes";
import { longDate, methodLabel, money2 } from "./payments-presenters";
import { isDismissalStale } from "./payoutDismissSnooze";
import { OperatorPaymentsView } from "./OperatorPaymentsView";
import { DisputesBand } from "./DisputesBand";
import { PaymentsTriageBand } from "./PaymentsTriageBand";
import { PayRequestsBand } from "./PayRequestsBand";
import { PaymentsKpiStrip } from "./PaymentsKpiStrip";
import { PaymentsYourMoney } from "./PaymentsYourMoney";
import { PaymentDetailSheet } from "./PaymentDetailSheet";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import { RefundDialog } from "./RefundDialog";
import { refundMath } from "./deriveRefunds";
import type {
  PaymentLedger,
  PaymentSort,
  PayoutDetailVM,
  PayoutRowVM,
  PayoutStatusFilter,
  RefundReason,
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

// A cancellation/no-show fee isn't a cleaning, so label it as such — otherwise a
// FAILED fee is indistinguishable from a failed job charge in the ledger (T2-7).
function serviceLabel(p: AdminPayment): string {
  if (p.charge_kind === "cancellation_fee") return "Cancellation fee";
  return p.appointment?.service_type?.name || "Cleaning";
}

function toTxnRow(p: AdminPayment, orgName: string, disputedIds: Set<string>): TransactionRowVM {
  const { payer, selfPay } = payerOf(p, orgName);
  return {
    id: p.id,
    dateLabel: longDate(p.appointment?.scheduled_date || p.created_at),
    payer,
    selfPay,
    service: serviceLabel(p),
    amountLabel: money2(p.amount),
    method: methodLabel(p.payment_method),
    badge: deriveTransactionBadge(p.status),
    disputed: disputedIds.has(p.id),
    partiallyRefunded: refundMath(p.amount, p.refunds).partiallyRefunded,
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
      canViewBookings={privileged || !!permissions?.can_view_bookings}
    />
  );
}

function OperatorPaymentsData({
  canManagePayments,
  canRefund,
  canViewBookings,
}: {
  canManagePayments: boolean;
  canRefund: boolean;
  canViewBookings: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { currentOrganizationId, currentOrganization } = useAuth();

  const {
    rows: payments,
    total: txnTotal,
    hasMore: txnHasMore,
    fetchNextPage: txnFetchNext,
    isFetchingNextPage: txnLoadingMore,
    loading: paymentsLoading,
    refetch: refetchPayments,
    error: paymentsError,
  } = useAdminPaymentsInfinite();
  const {
    rows: payouts,
    total: payoutTotal,
    hasMore: payoutHasMore,
    fetchNextPage: payoutFetchNext,
    isFetchingNextPage: payoutLoadingMore,
    loading: payoutsLoading,
    refetch: refetchPayouts,
    error: payoutsError,
  } = useAdminPayoutsInfinite();
  const { stats, loading: statsLoading, error: statsError, refetch: refetchStats } = usePaymentStats();
  // Open chargebacks tag their payment's ledger row so a disputed charge no
  // longer reads as a clean "Paid" (the DisputesBand owns the full surface).
  const { disputes } = useAdminDisputes();
  const openDisputedIds = useMemo(() => openDisputedPaymentIds(disputes), [disputes]);

  const hasError = Boolean(paymentsError || payoutsError || statsError);
  const onRetry = () => { void refetchPayments(); void refetchPayouts(); void refetchStats(); };

  const orgName = currentOrganization?.name || "Your company";
  const ledger: PaymentLedger = searchParams.get("ledger") === "payouts" ? "payouts" : "transactions";

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PaymentSort>("recent");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<TransactionDetailVM | null>(null);
  const [busy, setBusy] = useState(false);

  const setLedger = useCallback(
    (l: PaymentLedger) => {
      const params = new URLSearchParams(searchParams.toString());
      if (l === "payouts") params.set("ledger", "payouts");
      else params.delete("ledger");
      const qs = params.toString();
      replaceSearchShallow(qs ? `?${qs}` : "?");
    },
    [searchParams],
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
    }).map((p) => toTxnRow(p, orgName, openDisputedIds));
  }, [ledger, payments, search, statusFilter, sort, orgName, openDisputedIds]);

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
    const rm = refundMath(p.amount, p.refunds);
    return {
      id: p.id,
      appointmentId: p.appointment?.id ?? null,
      dateLabel: longDate(p.appointment?.scheduled_date || p.created_at),
      payer,
      selfPay,
      service: serviceLabel(p),
      amountLabel: money2(p.amount),
      method: methodLabel(p.payment_method),
      badge: deriveTransactionBadge(p.status),
      disputed: openDisputedIds.has(p.id),
      partiallyRefunded: rm.partiallyRefunded,
      reference: p.reference ?? null,
      notes: p.notes ?? null,
      createdLabel: longDate(p.created_at),
      paidLabel: p.paid_at ? longDate(p.paid_at) : null,
      // Refundable derives from a PaymentIntent (not payment_method): a manual
      // 'card' row has none and would 409; a settled ACH charge has one. Requires
      // something still left to refund.
      refundable:
        canRefund && p.status === "paid" && !!p.stripe_payment_intent_id && rm.remainingCents > 0,
      refundedLabel: rm.refundedCents > 0 ? money2(rm.refundedCents / 100) : null,
      grossAmount: p.amount,
      refundedAmount: rm.refundedCents / 100,
      remainingRefundable: rm.remainingCents / 100,
      feeRetryable: p.charge_kind === "cancellation_fee" && p.status === "failed",
      feeNeedsCardVerification: p.payment_intent_status === "requires_action",
    };
  }, [ledger, selectedRowId, payments, orgName, canRefund, openDisputedIds]);

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
      dismissedLabel: p.attention_dismissed_at ? longDate(p.attention_dismissed_at) : null,
      dismissalStale: isDismissalStale(p.attention_dismissed_at, Date.now()),
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
    async (id: string, amountDollars?: number, reason?: RefundReason) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/payments/${id}/refund`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            organization_id: currentOrganizationId,
            ...(typeof amountDollars === "number" ? { amount: amountDollars } : {}),
            ...(reason ? { reason } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Refund failed");
        toast.success(data.fully_refunded ? "Payment refunded" : "Partial refund issued");
        await refetchPayments();
        setRefundTarget(null);
        setSelectedRowId(null);
      } catch (e) {
        // Keep the dialog open so the operator can adjust the amount and retry.
        toast.error(e instanceof Error ? e.message : "Refund failed");
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, refetchPayments],
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
        toast.success(
          data.reason === "cleaner_slice_held"
            ? "Queued. It sends once the cleaner finishes payout setup."
            : "Payout retried",
        );
        await refetchPayouts();
        setSelectedRowId(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Retry failed");
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, refetchPayouts],
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
        if (!res.ok) throw new Error(data.error || "Could not snooze");
        toast.success("Snoozed for a day. It comes back if it keeps failing.");
        await refetchPayouts();
        setSelectedRowId(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not snooze");
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, refetchPayouts],
  );

  const handleUndismiss = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/payouts/${id}/undismiss`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ organization_id: currentOrganizationId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not restore");
        toast.success("Restored to Needs you now");
        await refetchPayouts();
        setSelectedRowId(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not restore");
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, refetchPayouts],
  );

  const handleRetryFee = useCallback(
    async (id: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/payments/${id}/retry-fee`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ organization_id: currentOrganizationId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const cents = Number(data.fee_captured_cents ?? 0);
          toast.success(cents > 0 ? `Fee collected: ${money2(cents / 100)}` : "Fee collected");
          queryClient.invalidateQueries({ queryKey: keys.payments.infinite(currentOrganizationId) });
          queryClient.invalidateQueries({ queryKey: keys.payments.statsByOrg(currentOrganizationId) });
        } else {
          toast.error(typeof data.error === "string" ? data.error : "Retry failed. Please try again.");
        }
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, authHeaders, queryClient],
  );

  // The redesign Messages screen creates/opens the thread itself from ?to=.
  const handleMessage = useCallback(
    async (cleanerId: string | null) => {
      router.push(
        cleanerId
          ? `/admin/messages?to=${cleanerId}`
          : "/admin/messages",
      );
    },
    [router],
  );

  // Close the payment sheet (local state) and open the booking sheet via
  // ?booking in one navigation; the global booking-detail host is mounted only
  // when canViewBookings, so onViewBooking is passed only in that case.
  const handleViewBooking = useCallback(
    (appointmentId: string) => {
      setSelectedRowId(null);
      const sp = new URLSearchParams(window.location.search);
      sp.set("booking", appointmentId);
      replaceSearchShallow(`?${sp.toString()}`);
    },
    [],
  );

  return (
    <>
      <OperatorPaymentsView
        loading={paymentsLoading || payoutsLoading}
        error={hasError}
        onRetry={onRetry}
        ledger={ledger}
        onLedgerChange={setLedger}
        txnRows={txnRows}
        payoutRows={payoutRows}
        txnTotal={txnTotal}
        payoutTotal={payoutTotal}
        hasMore={ledger === "transactions" ? txnHasMore : payoutHasMore}
        onLoadMore={() => {
          void (ledger === "transactions" ? txnFetchNext() : payoutFetchNext());
        }}
        loadingMore={ledger === "transactions" ? txnLoadingMore : payoutLoadingMore}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onOpenRow={setSelectedRowId}
        canManagePayments={canManagePayments}
        onRecordPayment={() => setRecordOpen(true)}
        disputesBand={<DisputesBand />}
        triage={<PaymentsTriageBand canManagePayments={canManagePayments} />}
        payRequests={<PayRequestsBand canManagePayments={canManagePayments} />}
        kpis={
          <PaymentsKpiStrip
            totalRevenue={stats?.totalRevenue ?? 0}
            thisMonth={stats?.thisMonthRevenue ?? 0}
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
        onRefund={() => {
          if (txnDetail) setRefundTarget(txnDetail);
        }}
        onRetry={handleRetry}
        onRetryFee={handleRetryFee}
        onDismiss={handleDismiss}
        onUndismiss={handleUndismiss}
        onMessage={handleMessage}
        onViewBooking={canViewBookings ? handleViewBooking : undefined}
      />

      <RecordPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        onRecorded={() => {
          void refetchPayments();
          // The recorded payment changes revenue/this-month, refresh the KPI
          // tiles (sourced from usePaymentStats, a separate query).
          if (currentOrganizationId) {
            void queryClient.invalidateQueries({
              queryKey: keys.payments.statsByOrg(currentOrganizationId),
            });
          }
        }}
      />

      <RefundDialog
        open={!!refundTarget}
        onOpenChange={(o) => {
          if (!o) setRefundTarget(null);
        }}
        payer={refundTarget?.payer ?? ""}
        grossLabel={refundTarget?.amountLabel ?? ""}
        refundedLabel={refundTarget?.refundedLabel ?? null}
        remaining={refundTarget?.remainingRefundable ?? 0}
        busy={busy}
        onConfirm={(amount, reason) => {
          if (refundTarget) void handleRefund(refundTarget.id, amount, reason);
        }}
      />
    </>
  );
}
