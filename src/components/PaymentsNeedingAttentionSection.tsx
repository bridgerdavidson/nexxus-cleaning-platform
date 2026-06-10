"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Loader2,
  Mail,
  CheckCircle,
  CreditCard,
  X,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useAppointmentPanel } from "../hooks/useAppointmentPanel";
import { supabase } from "../lib/supabase";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { stripeNewChargeFlowUiEnabled } from "../lib/stripe/flags";

interface AttnAppt {
  id: string;
  scheduled_date: string;
  total_price: number;
  authorization_status: string | null;
  homeowner_id: string | null;
  is_self_pay: boolean;
  homeowner: { first_name: string; last_name: string } | null;
}

interface AttnPayout {
  id: string;
  amount: number;
  status: string;
  appointment_id: string | null;
}

function formatDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * "Needs attention" panel for the Payments page (new charge flow only). Surfaces card
 * authorizations that failed or need the homeowner to act, plus cleaner payouts that
 * failed, so an admin/manager can resolve them without digging through Stripe. Failed
 * auths get a one-click re-authorize and a re-send-card-link action. Failed payouts get a
 * one-click "Retry now" (force settlement immediately) and a "Dismiss" (hide a stale or
 * already-handled row without deleting the payout or stopping the auto-retry sweep).
 *
 * A `reversed` payout is intentionally NOT shown: it is a completed clawback (dispute lost,
 * refund, or ACH return) and is not retried, so it needs no attention. Only `failed` payouts
 * (the cleaner was never paid) that have not been dismissed belong here.
 *
 * Self-contained: queries the org's appointments/payouts directly (RLS-scoped) so the
 * parent page's props stay unchanged. Captured-but-unsettled and onboarding-blocked cases
 * are handled by the reconciliation sweep (correctness backstop), so they're intentionally
 * not duplicated here.
 */
export default function PaymentsNeedingAttentionSection({
  onResolved,
  canManagePayments,
}: {
  onResolved?: () => void;
  /**
   * Whether the viewer may take payment actions (owner/admin, or a manager with
   * can_manage_payments). The retry/dismiss routes 403 for anyone else, so their
   * buttons are hidden from a view-only manager rather than rendered to fail on click.
   */
  canManagePayments: boolean;
}) {
  const { currentOrganizationId, currentOrganization } = useAuth();
  const { openAppointment } = useAppointmentPanel();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<AttnAppt[]>([]);
  const [payouts, setPayouts] = useState<AttnPayout[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkSentFor, setLinkSentFor] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    const [apptRes, payoutRes] = await Promise.all([
      supabase
        .from("appointments")
        .select(
          "id, scheduled_date, total_price, authorization_status, homeowner_id, is_self_pay, homeowner:user_profiles!homeowner_id(first_name, last_name)",
        )
        .eq("organization_id", currentOrganizationId)
        .in("authorization_status", ["failed", "requires_action"])
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: true }),
      supabase
        .from("payouts")
        .select("id, amount, status, appointment_id")
        .eq("organization_id", currentOrganizationId)
        // Only failed payouts need attention. A `reversed` payout is a completed, intentional
        // clawback (dispute/refund/ACH return) and is never retried, so it is excluded here.
        .eq("status", "failed")
        // Dismissed rows were acknowledged/handled by an admin; hide them (the auto-retry sweep
        // still keeps trying, so the cleaner is never silently stranded).
        .is("attention_dismissed_at", null)
        .order("created_at", { ascending: false }),
    ]);

    const apptRows = (apptRes.data ?? []).map((a) => ({
      ...a,
      homeowner: Array.isArray(a.homeowner) ? a.homeowner[0] : a.homeowner,
    })) as AttnAppt[];
    setAppts(apptRows);
    setPayouts((payoutRes.data ?? []) as AttnPayout[]);
    setLoading(false);
  }, [currentOrganizationId]);

  useEffect(() => {
    if (stripeNewChargeFlowUiEnabled()) void load();
  }, [load]);

  const sendCardLink = async (apptId: string, homeownerId: string | null) => {
    if (!currentOrganizationId || !homeownerId) return;
    setBusyId(apptId);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/billing/card-links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: currentOrganizationId, homeowner_id: homeownerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create card link");
      setLinkSentFor((m) => ({ ...m, [apptId]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create card link");
    } finally {
      setBusyId(null);
    }
  };

  const retryPayout = async (payoutId: string) => {
    if (!currentOrganizationId) return;
    setBusyId(payoutId);
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/payouts/${payoutId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: currentOrganizationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Retry failed");
      // Settled but re-held: the cleaner still has not finished payout setup, so it is queued
      // rather than paid. Say so instead of letting the row silently vanish.
      if (data.reason === "cleaner_slice_held") {
        setNotice(
          "The cleaner still needs to finish their payout setup, so this payment is queued and will send automatically once they do.",
        );
      }
      await load();
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusyId(null);
    }
  };

  const dismissPayout = async (payoutId: string) => {
    if (!currentOrganizationId) return;
    setBusyId(payoutId);
    setError(null);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/payouts/${payoutId}/dismiss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: currentOrganizationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not dismiss");
      await load();
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss");
    } finally {
      setBusyId(null);
    }
  };

  if (!stripeNewChargeFlowUiEnabled()) return null;
  if (loading) return null;
  if (appts.length === 0 && payouts.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
        <h3 className="text-base font-bold text-amber-900">Needs attention</h3>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
          {appts.length + payouts.length}
        </span>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-3 text-sm text-amber-700">{notice}</p>}

      <div className="space-y-2">
        {appts.map((a) => {
          // Self-pay has no homeowner: the payer is the company, so show the org name (not the
          // literal "Homeowner" default).
          const name = a.homeowner
            ? `${a.homeowner.first_name} ${a.homeowner.last_name}`
            : a.is_self_pay
              ? currentOrganization?.name || "Your company"
              : "Homeowner";
          const failed = a.authorization_status === "failed";
          const linkSent = linkSentFor[a.id];
          return (
            <div
              key={a.id}
              className="flex flex-col gap-3 rounded-xl border border-amber-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2.5">
                <CreditCard className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {name} · ${a.total_price?.toFixed(0)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDate(a.scheduled_date)} ·{" "}
                    {failed
                      ? "Card authorization failed"
                      : "Customer needs to verify their identity (3D Secure)"}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {/* Fixing a failed/unauthenticated hold means putting a WORKING card on, so this
                    opens the appointment drawer (company card for self-pay, saved card or new card
                    for homeowner) where the hold is re-placed with a fresh key. A blind retry of the
                    same declined card can't succeed, so there's no "Re-authorize" anymore. */}
                <button
                  onClick={() => openAppointment(a.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  Fix card
                </button>
                {/* Send card link only makes sense for a homeowner-paid job; self-pay uses the
                    company's own card, so there's no one to send a link to. */}
                {a.homeowner_id && (
                  <button
                    onClick={() => sendCardLink(a.id, a.homeowner_id)}
                    disabled={busyId === a.id || linkSent}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {linkSent ? (
                      <>
                        <CheckCircle className="h-3.5 w-3.5 text-success-600" /> Link sent
                      </>
                    ) : (
                      <>
                        <Mail className="h-3.5 w-3.5" /> Send card link
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {payouts.map((p) => (
          <div
            key={p.id}
            className="flex flex-col gap-3 rounded-xl border border-amber-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  Cleaner payout failed · ${p.amount?.toFixed(0)}
                </p>
                <p className="text-xs text-gray-500">
                  {canManagePayments
                    ? "Retry now, or dismiss if it's stale. Otherwise it retries automatically on the next sweep."
                    : "Retries automatically on the next reconciliation sweep."}
                </p>
              </div>
            </div>
            {canManagePayments && (
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  onClick={() => retryPayout(p.id)}
                  disabled={busyId === p.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {busyId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Retry now
                </button>
                <button
                  onClick={() => dismissPayout(p.id)}
                  disabled={busyId === p.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" /> Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
