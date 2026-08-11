'use client';

import { CalendarDays, MessageSquare, Plus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { OrgAvatar } from '@/components/branding/OrgAvatar';
import { InboxRow, InboxRowSkeleton } from '@/components/redesign/messages/InboxRow';
import { ListShell, SectionHeader } from '@/components/redesign/messages/InboxSections';
import { initialsFromFullName } from '@/components/redesign/messages/messages-format';
import { BOOKING_STATUS_VARIANT } from '@/components/redesign/messages/messages-pills';
import type { ConversationRowVM } from '@/components/redesign/messages/messages-types';
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

// Role-voiced copy (audit section 5 decision); variants come from the one
// shared status map so a cleaner sees the same status colors as everyone else.
const STATUS_LABEL: Record<CleanerJobRowVM['status'], string> = {
  pending: 'Requested',
  confirmed: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function OfficeRow({ row, onSelect }: { row: ConversationRowVM; onSelect: () => void }) {
  return (
    <InboxRow
      onSelect={onSelect}
      leading={
        <Avatar className="size-11 shrink-0">
          {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
          <AvatarFallback>{row.initials}</AvatarFallback>
        </Avatar>
      }
      name={row.name}
      timeLabel={row.timeLabel}
      preview={row.preview}
      previewAccessory={
        row.hasBooking ? (
          <CalendarDays className="size-3.5 shrink-0 text-primary/70" aria-label="Has a linked job" />
        ) : undefined
      }
      unreadCount={row.unreadCount}
    />
  );
}

function JobRow({ row, muted, onOpen }: { row: CleanerJobRowVM; muted?: boolean; onOpen: () => void }) {
  return (
    <InboxRow
      onSelect={onOpen}
      leading={
        <Avatar className="size-11 shrink-0">
          <AvatarFallback>{initialsFromFullName(row.homeownerName)}</AvatarFallback>
        </Avatar>
      }
      name={row.homeownerName}
      namePill={
        muted ? (
          <Badge variant="outline" className="shrink-0">
            Closed
          </Badge>
        ) : (
          <Badge variant={BOOKING_STATUS_VARIANT[row.status]} className="shrink-0">
            {STATUS_LABEL[row.status]}
          </Badge>
        )
      }
      timeLabel={row.timeLabel}
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

function StartOfficeRow({ onStart }: { onStart: () => void }) {
  return (
    <InboxRow
      onSelect={onStart}
      // The office IS the company: brand icon when uploaded, initials monogram
      // otherwise, round to match the people-avatars in the list.
      leading={<OrgAvatar size={44} />}
      name="Message your office"
      preview="Reach an admin or manager anytime"
    />
  );
}

function LoadingState() {
  return (
    <div className="space-y-6 py-1">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <ListShell>
        {Array.from({ length: 4 }).map((_, i) => (
          <InboxRowSkeleton key={i} />
        ))}
      </ListShell>
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

  const totalUnread = [...model.office, ...model.active, ...model.past].reduce(
    (n, r) => n + r.unreadCount,
    0,
  );
  const subtitle =
    totalUnread > 0
      ? `${totalUnread} unread message${totalUnread === 1 ? '' : 's'}`
      : 'Your office and cleaning conversations';

  return (
    <div className="space-y-6 py-1">
      {/* Same header idiom as the homeowner tab: title + the primary + trigger. */}
      <header className="space-y-0.5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold leading-tight">Messages</h1>
          {hasOfficeContacts && (
            <IconButton
              aria-label="New conversation"
              className="h-11 w-11 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onNew}
            >
              <Plus className="size-5" />
            </IconButton>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      {isEmpty ? (
        <div className="pt-6">
          <EmptyState
            icon={<MessageSquare />}
            title="No messages yet"
            description="Once your office adds an admin or manager, you can message them here. Homeowner threads appear during a cleaning."
          />
        </div>
      ) : (
        <>
      {(model.office.length > 0 || hasOfficeContacts) && (
        <section>
          <SectionHeader label="Office" count={model.office.length} />
          <ListShell>
            {model.office.length > 0 ? (
              model.office.map((r) => (
                <OfficeRow key={r.id} row={r} onSelect={() => onOpenOfficeRow(r.id)} />
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
        </>
      )}
    </div>
  );
}
