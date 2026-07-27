"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { keys } from "@/lib/queryKeys";
import { useOrgQuery } from "@/lib/useOrgQuery";
import { useSupabaseRealtimeSync } from "@/lib/useSupabaseRealtimeSync";
import { agoLabel } from "./payRequestMath";

// Data + actions for the Payments "Pay requests" band: the negotiation queue
// for request-mode cleaners. Open threads only (approved rows settle into the
// payouts ledger and drop off). Reads are RLS-scoped client selects; actions
// hit the service-role routes, which re-check permissions and hold the CAS
// guards, so a stale card can never double-move money.

type NamePair = { first_name?: string; last_name?: string } | null;

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

function fullName(p: NamePair): string {
  if (!p) return "";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

export type PayRequestOfferVM = {
  id: string;
  actor: "cleaner" | "org";
  amountCents: number;
  note: string | null;
  autoApproved: boolean;
  createdAt: string;
  atLabel: string;
};

export type PayRequestVM = {
  id: string;
  status: "pending_org" | "pending_cleaner";
  appointmentId: string;
  cleanerId: string;
  cleaner: string;
  jobLabel: string;
  dateLabel: string;
  jobPriceCents: number;
  /** The offer currently on the table (last in the thread). */
  latestAmountCents: number;
  latestActor: "cleaner" | "org";
  latestNote: string | null;
  ageLabel: string;
  /** jobPrice - latest ask. Negative = the ask is above the job price. */
  marginCents: number;
  /** Rounded percent of the job price the org keeps; null when price is 0. */
  marginPct: number | null;
  offers: PayRequestOfferVM[];
};

type RawRow = {
  id: string;
  status: string;
  appointment_id: string;
  cleaner_id: string;
  job_price_cents_snapshot: number;
  updated_at: string;
  cleaner: unknown;
  appointment: unknown;
  offers: {
    id: string;
    actor: string;
    amount_cents: number;
    note: string | null;
    auto_approved: boolean;
    created_at: string;
  }[] | null;
};

function toVM(row: RawRow, now: number): PayRequestVM | null {
  const offers = [...(row.offers ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const latest = offers[offers.length - 1];
  // A thread always opens with an offer; a row without one is mid-insert or
  // corrupt, so skip it rather than render a zero-dollar card.
  if (!latest) return null;

  const cleanerJoin = firstOf(row.cleaner as { user_profile?: NamePair | NamePair[] } | null);
  const cleanerName = fullName(firstOf(cleanerJoin?.user_profile)) || "Cleaner";

  const appt = firstOf(
    row.appointment as
      | { scheduled_date?: string; service_type?: { name?: string } | { name?: string }[] | null }
      | Array<{ scheduled_date?: string; service_type?: { name?: string } | { name?: string }[] | null }>
      | null,
  );
  const serviceName = firstOf(appt?.service_type)?.name ?? "Cleaning";
  const dateLabel = appt?.scheduled_date
    ? new Date(`${appt.scheduled_date}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";

  const price = Number(row.job_price_cents_snapshot ?? 0);
  const amount = Number(latest.amount_cents ?? 0);
  const margin = price - amount;

  return {
    id: row.id,
    status: row.status as PayRequestVM["status"],
    appointmentId: row.appointment_id,
    cleanerId: row.cleaner_id,
    cleaner: cleanerName,
    jobLabel: serviceName,
    dateLabel,
    jobPriceCents: price,
    latestAmountCents: amount,
    latestActor: latest.actor === "org" ? "org" : "cleaner",
    latestNote: latest.note ?? null,
    ageLabel: agoLabel(latest.created_at, now),
    marginCents: margin,
    marginPct: price > 0 ? Math.round((margin / price) * 100) : null,
    offers: offers.map((o) => ({
      id: o.id,
      actor: o.actor === "org" ? "org" : "cleaner",
      amountCents: Number(o.amount_cents ?? 0),
      note: o.note ?? null,
      autoApproved: !!o.auto_approved,
      createdAt: o.created_at,
      atLabel: agoLabel(o.created_at, now),
    })),
  };
}

export type PayRequestsQueue = {
  loading: boolean;
  error: boolean;
  /** Cleaner acted last; the org approves or counters. */
  waitingOnYou: PayRequestVM[];
  /** Org acted last; awareness only until the cleaner responds. */
  waitingOnCleaner: PayRequestVM[];
  isEmpty: boolean;
  busyId: string | null;
  approve: (payRequestId: string) => Promise<boolean>;
  counter: (payRequestId: string, amountCents: number, note: string | null) => Promise<boolean>;
  refresh: () => void;
};

export function usePayRequests(): PayRequestsQueue {
  const { currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useOrgQuery({
    queryKey: keys.payRequests.byOrg(currentOrganizationId ?? "anon"),
    staleTime: 15_000,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from("pay_requests")
        .select(
          `id, status, appointment_id, cleaner_id, job_price_cents_snapshot, updated_at,
           cleaner:cleaner_profiles!cleaner_id(user_profile:user_profiles(first_name, last_name)),
           appointment:appointments!appointment_id(scheduled_date, service_type:service_types(name)),
           offers:pay_request_offers(id, actor, amount_cents, note, auto_approved, created_at)`,
        )
        .eq("organization_id", orgId)
        .in("status", ["pending_org", "pending_cleaner"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const now = Date.now();
      return ((data as unknown as RawRow[]) ?? [])
        .map((r) => toVM(r, now))
        .filter((v): v is PayRequestVM => v !== null);
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: keys.payRequests.all });
  }, [queryClient]);

  // Every action (cleaner ask/counter/accept, org approve/counter, auto-approve)
  // flips or stamps the pay_requests row, so one table subscription covers the
  // whole thread. Offers ride along on the next refetch.
  useSupabaseRealtimeSync({
    channelName: `pay_requests:${currentOrganizationId ?? ""}`,
    table: "pay_requests",
    filter: currentOrganizationId ? `organization_id=eq.${currentOrganizationId}` : undefined,
    enabled: !!currentOrganizationId,
    onEvent: () => ({
      type: "invalidate",
      keys: [keys.payRequests.byOrg(currentOrganizationId ?? "anon"), keys.payRequests.pendingCount(currentOrganizationId ?? "anon")],
    }),
  });

  const act = useCallback(
    async (payRequestId: string, path: string, body: Record<string, unknown>): Promise<string | null> => {
      if (!currentOrganizationId) return "No organization";
      setBusyId(payRequestId);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/pay-requests/${payRequestId}/${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ organization_id: currentOrganizationId, ...body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return (data as { error?: string }).error || "Something went wrong";
        return null;
      } catch {
        return "Something went wrong";
      } finally {
        setBusyId(null);
        invalidate();
      }
    },
    [currentOrganizationId, invalidate],
  );

  const approve = useCallback(
    async (payRequestId: string) => {
      const err = await act(payRequestId, "approve", {});
      if (err) {
        toast.error(err);
        return false;
      }
      toast.success("Pay request approved");
      return true;
    },
    [act],
  );

  const counter = useCallback(
    async (payRequestId: string, amountCents: number, note: string | null) => {
      const err = await act(payRequestId, "counter", {
        amount_cents: amountCents,
        ...(note ? { note } : {}),
      });
      if (err) {
        toast.error(err);
        return false;
      }
      toast.success("Counter sent");
      return true;
    },
    [act],
  );

  const rows = query.data ?? [];
  const waitingOnYou = rows.filter((r) => r.status === "pending_org");
  const waitingOnCleaner = rows.filter((r) => r.status === "pending_cleaner");

  return {
    loading: query.isPending,
    error: query.isError,
    waitingOnYou,
    waitingOnCleaner,
    isEmpty: rows.length === 0,
    busyId,
    approve,
    counter,
    refresh: invalidate,
  };
}
