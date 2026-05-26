"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, DollarSign } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

interface PayoutRow {
  id: string;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-green-100 text-green-700",
  bank_paid: "bg-green-100 text-green-700",
  approved: "bg-blue-100 text-blue-700",
  pending: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700",
  reversed: "bg-red-100 text-red-700",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Cleaner-facing payout history. Lists the cleaner's own payouts (RLS-scoped) so they can see
 * what they've earned and the state of each transfer, alongside the embedded Connect views.
 */
export default function CleanerPayoutsHistory() {
  const { user, currentOrganizationId } = useAuth();
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    let q = supabase
      .from("payouts")
      .select("id, amount, status, paid_at, created_at")
      .eq("cleaner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (currentOrganizationId) q = q.eq("organization_id", currentOrganizationId);
    const { data } = await q;
    setRows((data ?? []) as PayoutRow[]);
    setLoading(false);
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="card mt-6 flex items-center gap-2 py-6 px-5 md:px-8 text-gray-500 mx-1 md:mx-0">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading payouts…
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="card mt-6 py-6 px-5 md:px-8 mx-1 md:mx-0">
      <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-4 flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-gray-400" /> Payout history
      </h2>
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">${Number(r.amount).toFixed(2)}</p>
              <p className="text-xs text-gray-500">{fmtDate(r.paid_at ?? r.created_at)}</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-700"
              }`}
            >
              {r.status === "bank_paid" ? "Paid out" : r.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
