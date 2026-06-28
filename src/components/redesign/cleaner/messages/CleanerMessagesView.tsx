"use client";

import { CalendarDays, MessageSquare, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CleanerConversationRow } from "./CleanerConversationRow";
import type { ConversationRowVM } from "@/components/redesign/messages/messages-types";
import type { OfficeInboxMode } from "./messages-cleaner-types";

export interface CleanerMessagesViewProps {
  mode: OfficeInboxMode;
  rows: ConversationRowVM[];
  noOfficeContacts: boolean;
  search: string;
  onSearch: (v: string) => void;
  onOpenRow: (id: string) => void;
  onCompose: () => void;
  /** A job armed from the active-job "Message office" button: a label for the banner. */
  armedJobLabel?: string | null;
  onCancelArm?: () => void;
}

/** The cleaner Messages inbox: search + "New message" compose + a list of office
 *  threads. (single/empty modes are handled by the container; this renders inbox.) */
export function CleanerMessagesView({
  mode,
  rows,
  noOfficeContacts,
  search,
  onSearch,
  onOpenRow,
  onCompose,
  armedJobLabel,
  onCancelArm,
}: CleanerMessagesViewProps) {
  if (mode === "loading") {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (mode === "empty") {
    return (
      <div className="py-6">
        <EmptyState
          icon={<MessageSquare />}
          title="No office contacts yet"
          description="Once your office adds an admin or manager, you can message them here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 py-1">
      {armedJobLabel && (
        <div className="flex items-center gap-2 rounded-control border border-primary/25 bg-primary/10 px-3 py-2">
          <CalendarDays className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">
            Attaching to your next message: {armedJobLabel}
          </span>
          {onCancelArm && (
            <button
              type="button"
              onClick={onCancelArm}
              aria-label="Cancel attaching the job"
              className="grid size-6 shrink-0 place-items-center rounded-full text-primary transition-colors hover:bg-primary/15"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
            className="pl-9"
          />
        </div>
        {!noOfficeContacts && (
          <Button onClick={onCompose} className="shrink-0 gap-1.5">
            <Plus className="size-4" aria-hidden /> New
          </Button>
        )}
      </div>

      <div className="-mx-4 overflow-hidden border-y border-border/60 bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {search ? "No matches." : "Message someone at your office to get started."}
          </p>
        ) : (
          rows.map((r) => (
            <CleanerConversationRow key={r.id} row={r} onSelect={() => onOpenRow(r.id)} />
          ))
        )}
      </div>
    </div>
  );
}
