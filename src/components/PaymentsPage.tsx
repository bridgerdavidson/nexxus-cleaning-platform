"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Loader2,
  DollarSign,
  TrendingUp,
  Clock,
  Plus,
  ChevronDown,
  FileText,
} from "lucide-react";
import RecordPaymentModal from "./RecordPaymentModal";
import RefundModal from "./RefundModal";
import PaymentsNeedingAttentionSection from "./PaymentsNeedingAttentionSection";
import StatusBadge from "./StatusBadge";
import { useAuth } from "../hooks/useAuth";
import { useManagerPermissions } from "../hooks/useManagerPermissions";
import { stripeNewChargeFlowUiEnabled } from "../lib/stripe/flags";

type TabType = "transactions" | "payouts" | "invoices";

interface PaymentStats {
  totalRevenue: number;
  pendingPayouts: number;
  thisMonthRevenue: number;
}

interface AdminPayment {
  id: string;
  amount: number;
  status: "pending" | "processing" | "paid" | "failed" | "refunded";
  payment_type?: string;
  payment_method?: string;
  reference?: string;
  notes?: string;
  paid_at?: string;
  created_at: string;
  is_self_pay?: boolean;
  appointment: {
    scheduled_date: string;
    homeowner: {
      first_name: string;
      last_name: string;
    } | null;
    service_type: {
      name: string;
    } | null;
  } | null;
}

interface AdminPayout {
  id: string;
  amount: number;
  status: "pending" | "approved" | "paid" | "failed";
  approved_at?: string;
  paid_at?: string;
  created_at: string;
  notes?: string;
  cleaner: {
    first_name: string;
    last_name: string;
  } | null;
  appointment: {
    scheduled_date: string;
    id: string;
  } | null;
}

interface AdminInvoice {
  id: string;
  invoice_number: string;
  amount: number;
  status: "draft" | "sent" | "paid" | "cancelled";
  due_date?: string;
  paid_at?: string;
  created_at: string;
  notes?: string;
  homeowner: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

interface PaymentsPageProps {
  payments: AdminPayment[];
  payouts: AdminPayout[];
  invoices: AdminInvoice[];
  stats: PaymentStats;
  paymentsLoading: boolean;
  payoutsLoading: boolean;
  invoicesLoading: boolean;
  statsLoading: boolean;
  onRefreshPayments: () => void;
  onRefreshPayouts: () => void;
  onRefreshInvoices: () => void;
}

export default function PaymentsPage({
  payments,
  payouts,
  invoices,
  stats,
  paymentsLoading,
  payoutsLoading,
  invoicesLoading,
  statsLoading,
  onRefreshPayments,
}: PaymentsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>("transactions");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);
  const [refundPayment, setRefundPayment] = useState<AdminPayment | null>(null);
  const { currentOrganizationId, currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  // Owners/admins always manage payments; managers need the explicit can_manage_payments flag.
  const canManagePayments =
    currentOrgRole === "owner" ||
    currentOrgRole === "admin" ||
    (currentOrgRole === "manager" && !!permissions?.can_manage_payments);
  // Refunds are only offered for captured card payments, under the new charge flow, to staff
  // who are allowed to manage payments.
  const refundsEnabled = stripeNewChargeFlowUiEnabled() && canManagePayments;

  // Filter by search query
  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => {
      const matchesSearch =
        !searchQuery ||
        payment.reference?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        payment.notes?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        payment.appointment?.homeowner?.first_name
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        payment.appointment?.homeowner?.last_name
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || payment.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [payments, searchQuery, statusFilter]);

  const filteredPayouts = useMemo(() => {
    return payouts.filter((payout) => {
      const matchesSearch =
        !searchQuery ||
        payout.cleaner?.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        payout.cleaner?.last_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        payout.notes?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || payout.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [payouts, searchQuery, statusFilter]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const matchesSearch =
        !searchQuery ||
        invoice.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        invoice.homeowner?.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        invoice.homeowner?.last_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        invoice.notes?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || invoice.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchQuery, statusFilter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "text-yellow-700 bg-yellow-100";
      case "paid":
      case "approved":
        return "text-green-700 bg-green-100";
      case "failed":
      case "cancelled":
        return "text-red-700 bg-red-100";
      case "draft":
        return "text-gray-700 bg-gray-100";
      case "sent":
        return "text-blue-700 bg-blue-100";
      case "refunded":
        return "text-purple-700 bg-purple-100";
      case "processing":
        // ACH debit clearing; matches the "Clearing" chip on the cards.
        return "text-amber-700 bg-amber-100";
      default:
        return "text-gray-700 bg-gray-100";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-4xl font-bold text-gray-900">Finance</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Revenue</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-xl font-bold text-gray-900">
                  ${stats.totalRevenue.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Pending Payouts</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-xl font-bold text-gray-900">
                  ${stats.pendingPayouts.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">This Month</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-xl font-bold text-gray-900">
                  ${stats.thisMonthRevenue.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Payments needing attention (failed auths / failed payouts) — new charge flow only */}
      <PaymentsNeedingAttentionSection onResolved={onRefreshPayments} />

      {/* Tabs and Actions */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          {/* Tabs */}
          <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
            <button
              onClick={() => {
                setActiveTab("transactions");
                setSearchQuery("");
                setStatusFilter("all");
              }}
              className={`px-4 py-2 font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === "transactions"
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Transactions
            </button>
            <button
              onClick={() => {
                setActiveTab("payouts");
                setSearchQuery("");
                setStatusFilter("all");
              }}
              className={`px-4 py-2 font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === "payouts"
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Payouts
            </button>
            <button
              onClick={() => {
                setActiveTab("invoices");
                setSearchQuery("");
                setStatusFilter("all");
              }}
              className={`px-4 py-2 font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === "invoices"
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Invoices
            </button>
          </div>

          {/* Action Button */}
          {activeTab === "transactions" && (
            <button
              onClick={() => setShowRecordPaymentModal(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <Plus className="w-5 h-5" />
              Record Payment
            </button>
          )}
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="appearance-none pl-4 pr-10 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm"
            >
              <option value="all">All Status</option>
              {activeTab === "transactions" && (
                <>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="failed">Failed</option>
                  <option value="refunded">Refunded</option>
                </>
              )}
              {activeTab === "payouts" && (
                <>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                  <option value="failed">Failed</option>
                </>
              )}
              {activeTab === "invoices" && (
                <>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="cancelled">Cancelled</option>
                </>
              )}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
          </div>
        </div>

        {/* Transactions Table */}
        {activeTab === "transactions" && (
          <>
            {paymentsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">Loading transactions...</span>
              </div>
            ) : filteredPayments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Reference
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Client
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Notes
                      </th>
                      {refundsEnabled && (
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {formatDate(payment.paid_at || payment.created_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {payment.reference || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {payment.appointment?.homeowner
                            ? `${payment.appointment.homeowner.first_name} ${payment.appointment.homeowner.last_name}`
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                          ${payment.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                                payment.status
                              )}`}
                            >
                              {payment.status === "processing" ? "Clearing" : payment.status}
                            </span>
                            {payment.is_self_pay && (
                              <StatusBadge status="self_pay" size="sm" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {payment.payment_method || "manual"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                          {payment.notes || "-"}
                        </td>
                        {refundsEnabled && (
                          <td className="px-4 py-3 text-right">
                            {payment.status === "paid" && payment.payment_method === "card" ? (
                              <button
                                onClick={() => setRefundPayment(payment)}
                                className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                Refund
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No transactions found</p>
              </div>
            )}
          </>
        )}

        {/* Payouts Table */}
        {activeTab === "payouts" && (
          <>
            {payoutsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">Loading payouts...</span>
              </div>
            ) : filteredPayouts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Cleaner Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Booking Reference
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredPayouts.map((payout) => (
                      <tr key={payout.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {formatDate(payout.created_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {payout.cleaner
                            ? `${payout.cleaner.first_name} ${payout.cleaner.last_name}`
                            : "Unknown"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {payout.appointment?.scheduled_date || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                          ${payout.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                              payout.status
                            )}`}
                          >
                            {payout.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No payouts found</p>
              </div>
            )}
          </>
        )}

        {/* Invoices Table */}
        {activeTab === "invoices" && (
          <>
            {invoicesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">Loading invoices...</span>
              </div>
            ) : filteredInvoices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Invoice #
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Client
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Due Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredInvoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-mono text-gray-900">
                          {invoice.invoice_number}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {formatDate(invoice.created_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {invoice.homeowner
                            ? `${invoice.homeowner.first_name} ${invoice.homeowner.last_name}`
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                          ${invoice.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                              invoice.status
                            )}`}
                          >
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {invoice.due_date ? formatDate(invoice.due_date) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No invoices found</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      <RecordPaymentModal
        isOpen={showRecordPaymentModal}
        onClose={() => setShowRecordPaymentModal(false)}
        onPaymentRecorded={() => {
          onRefreshPayments();
          setShowRecordPaymentModal(false);
        }}
      />

      {refundPayment && currentOrganizationId && (
        <RefundModal
          paymentId={refundPayment.id}
          organizationId={currentOrganizationId}
          amountPaid={refundPayment.amount}
          onClose={() => setRefundPayment(null)}
          onDone={() => {
            onRefreshPayments();
            setRefundPayment(null);
          }}
        />
      )}
    </div>
  );
}
