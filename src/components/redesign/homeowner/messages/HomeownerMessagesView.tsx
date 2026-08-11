'use client';

import { ChevronRight, MessageSquare, Plus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { OrgLogo } from '@/components/branding/OrgLogo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { InboxRow, InboxRowSkeleton } from '@/components/redesign/messages/InboxRow';
import { ListShell, SectionHeader } from '@/components/redesign/messages/InboxSections';
import { initialsFromFullName } from '@/components/redesign/messages/messages-format';
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
    <InboxRow
      onSelect={office ? onOpenThread : onStart}
      // The office IS the company: brand icon when uploaded, initials monogram otherwise.
      leading={<OrgLogo variant="icon" size={44} className="shrink-0" />}
      name="Cleaning office"
      timeLabel={office?.timeLabel || undefined}
      preview={office ? office.preview : 'Message your office anytime'}
      unreadCount={office?.unreadCount ?? 0}
      trailing={
        office ? undefined : (
          <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        )
      }
    />
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
    <InboxRow
      onSelect={onOpen}
      leading={
        <Avatar className="size-11 shrink-0">
          {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initialsFromFullName(row.cleanerName)}</AvatarFallback>
        </Avatar>
      }
      name={row.cleanerName}
      namePill={
        muted ? (
          <Badge variant="outline" className="shrink-0">
            Closed
          </Badge>
        ) : (
          // Role-voiced copy ("All done"); variant from the one shared status map.
          <Badge variant={BOOKING_STATUS_VARIANT[row.status]} className="shrink-0">
            {status.label}
          </Badge>
        )
      }
      timeLabel={row.timeLabel || undefined}
      preview={row.preview}
      previewMuted={muted}
      unreadCount={row.unreadCount}
      thirdLine={
        <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">
          {row.dateLabel} cleaning
        </span>
      }
    />
  );
}

function LoadingState() {
  return (
    <div className="space-y-6 pt-1">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <ListShell>
        {Array.from({ length: 3 }).map((_, i) => (
          <InboxRowSkeleton key={i} />
        ))}
      </ListShell>
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
          {/* The one compose affordance (D11): the primary + icon-button. */}
          <IconButton
            aria-label="New conversation"
            className="h-11 w-11 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onNewConversation}
          >
            <Plus className="size-5" />
          </IconButton>
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
            <ListShell>
              {model.office.length > 0 ? (
                model.office.map((row) => (
                  <OfficeRow
                    key={row.id}
                    office={row}
                    onOpenThread={() => onOpenOfficeThread(row.id)}
                    onStart={onOpenOffice}
                  />
                ))
              ) : (
                <OfficeRow office={null} onOpenThread={() => {}} onStart={onOpenOffice} />
              )}
            </ListShell>
          </section>

          {model.active.length > 0 ? (
            <section>
              <SectionHeader label="Your cleanings" count={model.active.length} />
              <ListShell>
                {model.active.map((row) => (
                  <JobRow
                    key={row.conversationId}
                    row={row}
                    onOpen={() => onOpenJob(row.appointmentId)}
                  />
                ))}
              </ListShell>
            </section>
          ) : null}

          {model.past.length > 0 ? (
            <section>
              <SectionHeader label="Past" count={model.past.length} />
              <ListShell>
                {model.past.map((row) => (
                  <JobRow
                    key={row.conversationId}
                    row={row}
                    muted
                    onOpen={() => onOpenJob(row.appointmentId)}
                  />
                ))}
              </ListShell>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
