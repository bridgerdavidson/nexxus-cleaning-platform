'use client';

import { ChevronRight, MessageCircle, MessageSquare, PenSquare } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BOOKING_STATUS_VARIANT } from '@/components/redesign/messages/messages-pills';
import { homeownerStatusLabel } from '../home/home-presenters';
import type { HomeownerInboxModel, JobThreadRowVM } from './homeowner-messages-types';


export interface HomeownerMessagesViewProps {
  model: HomeownerInboxModel;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  onOpenOffice: () => void;
  onOpenOfficeThread: (conversationId: string) => void;
  onOpenJob: (appointmentId: string) => void;
  onNewConversation: () => void;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Unread indicator: a brand pill that always pairs its color with the count
 *  (never color alone) plus an sr-only label. Mirrors the bottom-nav badge. */
function UnreadPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex shrink-0 items-center">
      <span
        aria-hidden
        className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold leading-none tabular-nums text-white"
      >
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only">{count} unread</span>
    </span>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-0.5">
      <h2 className="text-sm font-bold">{label}</h2>
      <span className="ml-auto text-xs font-medium text-muted-foreground">{count}</span>
    </div>
  );
}

const ROW_BASE =
  'flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring';

function OfficeRow({
  office,
  onOpenThread,
  onStart,
}: {
  office: HomeownerInboxModel['office'][number] | null;
  onOpenThread: () => void;
  onStart: () => void;
}) {
  return (
    <button type="button" onClick={office ? onOpenThread : onStart} className={ROW_BASE}>
      <span
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-pill bg-primary/10 text-primary"
      >
        <MessageCircle className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold">Cleaning office</span>
          {office?.timeLabel ? (
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {office.timeLabel}
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            'mt-1 truncate text-sm',
            office && office.unreadCount > 0
              ? 'font-medium text-foreground'
              : 'text-muted-foreground',
          )}
        >
          {office ? office.preview : 'Message your office anytime'}
        </p>
      </div>
      {office ? (
        <UnreadPill count={office.unreadCount} />
      ) : (
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

function JobRow({
  row,
  muted,
  onOpen,
}: {
  row: JobThreadRowVM;
  muted?: boolean;
  onOpen: () => void;
}) {
  const status = homeownerStatusLabel(row.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(ROW_BASE, muted && 'bg-muted/30 shadow-none')}
    >
      <Avatar className="size-11 shrink-0">
        {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
        <AvatarFallback>{initialsFromName(row.cleanerName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold">{row.cleanerName}</span>
          {muted ? (
            <Badge variant="outline" className="shrink-0">
              Closed
            </Badge>
          ) : (
            // Role-voiced copy ("All done"); variant from the one shared status map.
            <Badge variant={BOOKING_STATUS_VARIANT[row.status]} className="shrink-0">
              {status.label}
            </Badge>
          )}
          {row.timeLabel ? (
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {row.timeLabel}
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            'mt-1 truncate text-sm',
            !muted && row.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {row.preview}
        </p>
        <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
          {row.dateLabel} cleaning
        </p>
      </div>
      {!muted ? <UnreadPill count={row.unreadCount} /> : null}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6 pt-1">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
      </div>
    </div>
  );
}

export function HomeownerMessagesView({
  model,
  loading,
  error,
  onRetry,
  onOpenOffice,
  onOpenOfficeThread,
  onOpenJob,
  onNewConversation,
}: HomeownerMessagesViewProps) {
  if (error) {
    return (
      <div className="py-8">
        <ErrorState title="Couldn't load messages" onRetry={onRetry} />
      </div>
    );
  }

  if (loading) return <LoadingState />;

  const officeUnread = model.office.reduce((n, r) => n + r.unreadCount, 0);
  const jobUnread = [...model.active, ...model.past].reduce((n, r) => n + r.unreadCount, 0);
  const totalUnread = officeUnread + jobUnread;
  const subtitle =
    totalUnread > 0
      ? `${totalUnread} unread message${totalUnread === 1 ? '' : 's'}`
      : 'Your office and cleaning conversations';

  const isEmpty =
    model.office.length === 0 && model.active.length === 0 && model.past.length === 0;

  return (
    <div className="space-y-6 pt-1">
      <header className="space-y-0.5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold leading-tight">Messages</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="New conversation"
            onClick={onNewConversation}
          >
            <PenSquare className="size-5" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      {isEmpty ? (
        <div className="pt-6">
          <EmptyState
            icon={<MessageSquare />}
            title="No messages yet"
            description="Message your cleaning office anytime, or message your cleaner during a cleaning."
            action={
              <Button type="button" onClick={onOpenOffice}>
                Message office
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <section>
            <SectionHeader label="Office" count={model.office.length} />
            {model.office.length > 0 ? (
              <div className="space-y-2.5">
                {model.office.map((row) => (
                  <OfficeRow
                    key={row.id}
                    office={row}
                    onOpenThread={() => onOpenOfficeThread(row.id)}
                    onStart={onOpenOffice}
                  />
                ))}
              </div>
            ) : (
              <OfficeRow office={null} onOpenThread={() => {}} onStart={onOpenOffice} />
            )}
          </section>

          {model.active.length > 0 ? (
            <section>
              <SectionHeader label="Your cleanings" count={model.active.length} />
              <div className="space-y-2.5">
                {model.active.map((row) => (
                  <JobRow
                    key={row.conversationId}
                    row={row}
                    onOpen={() => onOpenJob(row.appointmentId)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {model.past.length > 0 ? (
            <section>
              <SectionHeader label="Past" count={model.past.length} />
              <div className="space-y-2.5">
                {model.past.map((row) => (
                  <JobRow
                    key={row.conversationId}
                    row={row}
                    muted
                    onOpen={() => onOpenJob(row.appointmentId)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
