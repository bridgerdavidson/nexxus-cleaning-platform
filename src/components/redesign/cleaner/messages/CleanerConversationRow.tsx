"use client";

import { CalendarDays } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConversationRowVM } from "@/components/redesign/messages/messages-types";

/** A cleaner inbox row: avatar + name + preview + time + unread. Trimmed from the
 *  operator ConversationRow (no role pill, no hover-delete) since every counterpart
 *  is "the office". */
export function CleanerConversationRow({
  row,
  onSelect,
}: {
  row: ConversationRowVM;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left",
        "touch-manipulation transition-colors active:bg-accent hover:bg-accent/60",
      )}
    >
      <Avatar className="size-11 shrink-0">
        {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
        <AvatarFallback>{row.initials}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-bold leading-tight">{row.name}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {row.timeLabel}
          </span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              row.unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {row.preview}
          </span>
          {row.hasBooking && (
            <CalendarDays className="size-3.5 shrink-0 text-primary/70" aria-label="Has a linked job" />
          )}
          {row.unreadCount > 0 && (
            <Badge className="h-5 min-w-[1.25rem] shrink-0 justify-center rounded-full px-1.5 py-0 text-[10px] leading-5">
              {row.unreadCount > 99 ? "99+" : row.unreadCount}
            </Badge>
          )}
        </span>
      </span>
    </button>
  );
}
