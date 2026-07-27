"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { keys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseRealtimeSync } from "@/lib/useSupabaseRealtimeSync";

/**
 * Count of pay requests waiting on the org (status = pending_org). Drives the
 * operator nav badge on Payments & payouts. Modeled on useUnreadMessageCount:
 * one head-count query + one realtime channel, so the always-mounted shell
 * never pays for the full queue. The channel name matches usePayRequests so
 * the two share a single Supabase subscription when Payments is open.
 * `enabled` should be the viewer's payment visibility (privileged or
 * can_view_payments); RLS enforces it anyway, this just skips dead queries.
 */
export function usePayRequestsPendingCount(enabled: boolean): number {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? undefined;
  const key = keys.payRequests.pendingCount(orgId ?? "anon");

  const query = useQuery({
    queryKey: key,
    enabled: !!orgId && enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("pay_requests")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId as string)
        .eq("status", "pending_org");
      if (error) throw error;
      return count ?? 0;
    },
  });

  useSupabaseRealtimeSync({
    enabled: !!orgId && enabled,
    channelName: `pay_requests:${orgId ?? ""}`,
    table: "pay_requests",
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    onEvent: () => ({ type: "invalidate", keys: [key] }),
  });

  return query.data ?? 0;
}
