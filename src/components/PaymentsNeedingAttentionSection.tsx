"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Loader2,
  Mail,
  CheckCircle,
  CreditCard,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { stripeNewChargeFlowUiEnabled } from "../lib/stripe/flags";

interface AttnAppt {
  id: string;
  scheduled_date: string;
  total_price: number;
  authorization_status: string | null;
  homeowner_id: string | null;
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
 * authorizations that failed or need the homeowner to act, plus payouts that failed or
 * reversed, so an admin/manager can resolve them without digging through Stripe. Failed
 * auths get a one-click re-authorize and a re-send-card-link action.
 *
 * Self-contained: queries the org's appointments/payouts directly (RLS-scoped) so the
 * parent page's props stay unchanged. Captured-but-unsettled and onboarding-blocked cases
 * are handled by the reconciliation sweep (correctness backstop), so they're intentionally
 * not duplicated here.
 */
export default function PaymentsNeedingAttentionSection({
  onResolved,
}: {
  onResolved?: () => void;
}) {
  const { currentOrganizationId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<AttnAppt[]>([]);
  const [payouts, setPayouts] = useState<AttnPayout[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkSentFor, setLinkSentFor] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganizationId) return;
    setLoading(true);
    const [apptRes, payoutRes] = await Promise.all([
      supabase
        .from("appointments")
        .select(
          "id, scheduled_date, total_price, authorization_status, homeowner_id, homeowner:user_profiles!homeowner_id(first_name, last_name)",
        )
        .eq("organization_id", currentOrganizationId)
        .in("authorization_status", ["failed", "requires_action"])
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: true }),
      supabase
        .from("payouts")
        .select("id, amount, status, appointment_id")
        .eq("organization_id", currentOrganizationId)
        .in("status", ["failed", "reversed"])
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

  const reauthorize = async (apptId: string) => {
    if (!currentOrganizationId) return;
    setBusyId(apptId);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${apptId}/authorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: currentOrganizationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Re-authorization failed");
      await load();
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-authorization failed");
    } finally {
      setBusyId(null);
    }
  };

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

      <div className="space-y-2">
        {appts.map((a) => {
          const name = a.homeowner
            ? `${a.homeowner.first_name} ${a.homeowner.last_name}`
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
                    {failed ? "Card authorization failed" : "Waiting on homeowner to confirm a card"}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {failed && (
                  <button
                    onClick={() => reauthorize(a.id)}
                    disabled={busyId === a.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
                  >
                    {busyId === a.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Re-authorize
                  </button>
                )}
                <button
                  onClick={() => sendCardLink(a.id, a.homeowner_id)}
                  disabled={busyId === a.id || linkSent || !a.homeowner_id}
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
              </div>
            </div>
          );
        })}

        {payouts.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-xl border border-amber-100 bg-white p-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Cleaner payout {p.status === "reversed" ? "reversed" : "failed"} · ${p.amount?.toFixed(0)}
                </p>
                <p className="text-xs text-gray-500">
                  Will retry on the next reconciliation sweep; check the cleaner&apos;s payout setup.
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
