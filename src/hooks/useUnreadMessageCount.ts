"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { keys } from "@/lib/queryKeys";
import { useSupabaseRealtimeSync } from "@/lib/useSupabaseRealtimeSync";

/**
 * Total unread messages addressed to `userId` (recipient_id = me, is_read = false).
 * Drives the Messages bottom-nav badge. Deliberately separate from useConversations
 * so the always-rendered shell does not mount the full inbox (its 4 realtime
 * channels) on every cleaner page; this is one count query + one realtime channel.
 * This is conversation unread, distinct from the notification bell's outbox.
 */
export function useUnreadMessageCount(
  userId: string | undefined,
  scope: 'office' | 'all' = 'office',
): number {
  const key = keys.messages.unreadCount(userId ?? "anon", scope);

  const query = useQuery({
    queryKey: key,
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async () => {
      let q = supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId as string)
        .eq("is_read", false);
      if (scope === "office") q = q.is("appointment_id", null);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  useSupabaseRealtimeSync({
    enabled: !!userId,
    channelName: `messages:recipient:${userId ?? "anon"}:badge:${scope}`,
    table: "messages",
    filter: userId ? `recipient_id=eq.${userId}` : undefined,
    onEvent: () => ({ type: "invalidate", keys: [key] }),
  });

  return query.data ?? 0;
}
