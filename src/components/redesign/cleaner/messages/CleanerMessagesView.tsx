'use client';

import { MessageSquare, Plus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CleanerConversationRow } from './CleanerConversationRow';
import type { CleanerInboxModel, CleanerJobRowVM } from './cleaner-inbox-types';

export interface CleanerMessagesViewProps {
  model: CleanerInboxModel;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  hasOfficeContacts: boolean;
  onOpenOfficeRow: (conversationId: string) => void;
  onStartOffice: () => void;
  onNew: () => void;
  onOpenJob: (appointmentId: string) => void;
}

const STATUS_LABEL: Record<
  CleanerJobRowVM['status'],
  { label: string; variant: 'default' | 'secondary' | 'positive' | 'caution' | 'critical' }
> = {
  pending: { label: 'Requested', variant: 'secondary' },
  confirmed: { label: 'Scheduled', variant: 'default' },
  in_progress: { label: 'In progress', variant: 'positive' },
  completed: { label: 'Completed', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'critical' },
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-0.5">
      <h2 className="text-sm font-bold">{label}</h2>
      <span className="ml-auto text-xs font-medium text-muted-foreground">{count}</span>
    </div>
  );
}

function ListShell({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-hidden border-y border-border/60 bg-card">{children}</div>;
}

function JobRow({ row, muted, onOpen }: { row: CleanerJobRowVM; muted?: boolean; onOpen: () => void }) {
  const status = STATUS_LABEL[row.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
        'touch-manipulation transition-colors active:bg-accent hover:bg-accent/60',
      )}
    >
      <Avatar className="size-11 shrink-0">
        <AvatarFallback>{initialsFromName(row.homeownerName)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-bold leading-tight">{row.homeownerName}</span>
          {muted ? (
            <Badge variant="outline" className="shrink-0">
              Closed
            </Badge>
          ) : (
            <Badge variant={status.variant} className="shrink-0">
              {status.label}
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {row.timeLabel}
          </span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px]',
              !muted && row.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {row.preview}
          </span>
          {!muted && row.unreadCount > 0 && (
            <span className="flex shrink-0 items-center">
              <Badge className="h-5 min-w-[1.25rem] justify-center rounded-full px-1.5 py-0 text-[10px] leading-5">
                {row.unreadCount > 99 ? '99+' : row.unreadCount}
              </Badge>
              <span className="sr-only">{row.unreadCount} unread</span>
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">
          {row.dateLabel} cleaning
        </span>
      </span>
    </button>
  );
}

function StartOfficeRow({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
        'touch-manipulation transition-colors active:bg-accent hover:bg-accent/60',
      )}
    >
      <span
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-pill bg-primary/10 text-primary"
      >
        <MessageSquare className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold leading-tight">Message your office</span>
        <span className="mt-1 block truncate text-[13px] text-muted-foreground">
          Reach an admin or manager anytime
        </span>
      </span>
    </button>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-card" />
      ))}
    </div>
  );
}

/** The cleaner Messages inbox: a sectioned list (Office + Your cleanings + Past),
 *  mirroring the homeowner Messages tab. Container handles data + navigation. */
export function CleanerMessagesView({
  model,
  loading,
  error,
  onRetry,
  hasOfficeContacts,
  onOpenOfficeRow,
  onStartOffice,
  onNew,
  onOpenJob,
}: CleanerMessagesViewProps) {
  if (error) {
    return <ErrorState title="Couldn't load messages" onRetry={onRetry} />;
  }
  if (loading) return <LoadingState />;

  const hasOffice = model.office.length > 0 || hasOfficeContacts;
  const isEmpty = !hasOffice && model.active.length === 0 && model.past.length === 0;

  if (isEmpty) {
    return (
      <div className="py-6">
        <EmptyState
          icon={<MessageSquare />}
          title="No messages yet"
          description="Once your office adds an admin or manager, you can message them here. Homeowner threads appear during a cleaning."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-1">
      {hasOfficeContacts && (
        <div className="flex items-center justify-end">
          <Button onClick={onNew} className="gap-1.5">
            <Plus className="size-4" aria-hidden /> New
          </Button>
        </div>
      )}

      {(model.office.length > 0 || hasOfficeContacts) && (
        <section>
          <SectionHeader label="Office" count={model.office.length} />
          <ListShell>
            {model.office.length > 0 ? (
              model.office.map((r) => (
                <CleanerConversationRow key={r.id} row={r} onSelect={() => onOpenOfficeRow(r.id)} />
              ))
            ) : (
              <StartOfficeRow onStart={onStartOffice} />
            )}
          </ListShell>
        </section>
      )}

      {model.active.length > 0 && (
        <section>
          <SectionHeader label="Your cleanings" count={model.active.length} />
          <ListShell>
            {model.active.map((r) => (
              <JobRow key={r.conversationId} row={r} onOpen={() => onOpenJob(r.appointmentId)} />
            ))}
          </ListShell>
        </section>
      )}

      {model.past.length > 0 && (
        <section>
          <SectionHeader label="Past" count={model.past.length} />
          <ListShell>
            {model.past.map((r) => (
              <JobRow key={r.conversationId} row={r} muted onOpen={() => onOpenJob(r.appointmentId)} />
            ))}
          </ListShell>
        </section>
      )}
    </div>
  );
}
