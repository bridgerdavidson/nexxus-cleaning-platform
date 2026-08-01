"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { keys } from "@/lib/queryKeys";

/**
 * The cleaner's own pay-request threads, via the service-role route.
 *
 * NOT a Supabase query: migration 119 removed the cleaner's SELECT arm on
 * pay_requests because the row carries the job price they must never see.
 * `/api/pay-requests/mine` shapes a price-free payload instead.
 *
 * NO REALTIME, deliberately. Supabase postgres_changes is RLS-gated per
 * subscriber (walrus re-evaluates the SELECT policy with the subscriber's
 * claims), so with 119 in place a cleaner subscription would be silently
 * filtered out of every change and never fire. Polling is the honest signal
 * here: an org counter must reach the cleaner without them reloading the app,
 * and this is a small price-free payload on one screen.
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
  status: "pending_org" | "pending_cleaner" | "approved";
  currentOfferCents: number;
  /** Set once agreed; the amount that will actually be paid. */
  approvedAmountCents: number | null;
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
    // The cleaner cannot receive realtime for this table (see above), and the
    // app disables refetch-on-focus globally, so without this an org counter
    // would sit unseen until the cleaner navigated away and back.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
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

  return {
    threads: query.data?.threads ?? [],
    anchor: query.data?.anchor ?? null,
    loading: query.isPending,
    error: query.isError,
    refetch: query.refetch,
  };
}
