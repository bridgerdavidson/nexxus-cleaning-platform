"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { keys } from "@/lib/queryKeys";
import { useSupabaseRealtimeSync } from "@/lib/useSupabaseRealtimeSync";

/**
 * The cleaner's own pay-request threads, via the service-role route.
 *
 * NOT a Supabase query: migration 119 removed the cleaner's SELECT arm on
 * pay_requests because the row carries the job price they must never see.
 * `/api/pay-requests/mine` shapes a price-free payload instead. Realtime still
 * works, because the postgres_changes subscription only needs to know THAT the
 * row changed (it triggers a refetch through the route, it does not read the
 * payload).
 */

export type CleanerPayOffer = {
  id: string;
  actor: "cleaner" | "org";
  amountCents: number;
  note: string | null;
  createdAt: string;
};

export type CleanerPayThread = {
  id: string;
  appointmentId: string;
  status: "pending_org" | "pending_cleaner";
  currentOfferCents: number;
  jobLabel: string;
  propertyLabel: string | null;
  scheduledDate: string | null;
  updatedAt: string;
  offers: CleanerPayOffer[];
};

/** What this cleaner was last approved for; their only reference point, since
 *  the job price is hidden from them. */
export type PayAnchor = { amountCents: number; samePlace: boolean };

type MineResponse = { threads: CleanerPayThread[]; anchor: PayAnchor | null };

export function useCleanerPayRequests(opts?: { appointmentId?: string; enabled?: boolean }) {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id;
  const appointmentId = opts?.appointmentId;
  const enabled = (opts?.enabled ?? true) && !!userId && !!currentOrganizationId;

  const queryKey = [
    ...keys.payRequests.byCleaner(userId ?? "anon"),
    currentOrganizationId ?? "",
    appointmentId ?? "",
  ] as const;

  const query = useQuery({
    queryKey,
    enabled,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<MineResponse> => {
      const token = await getAccessToken();
      const qs = new URLSearchParams({ organization_id: currentOrganizationId as string });
      if (appointmentId) qs.set("appointment_id", appointmentId);
      const res = await fetch(`/api/pay-requests/mine?${qs.toString()}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal,
      });
      if (!res.ok) throw new Error("Could not load your pay requests");
      return (await res.json()) as MineResponse;
    },
  });

  useSupabaseRealtimeSync({
    enabled,
    channelName: `pay_requests:cleaner:${userId ?? "anon"}`,
    table: "pay_requests",
    filter: userId ? `cleaner_id=eq.${userId}` : undefined,
    onEvent: () => ({ type: "invalidate", keys: [keys.payRequests.byCleaner(userId ?? "anon")] }),
  });

  return {
    threads: query.data?.threads ?? [],
    anchor: query.data?.anchor ?? null,
    loading: query.isPending,
    error: query.isError,
    refetch: query.refetch,
  };
}
