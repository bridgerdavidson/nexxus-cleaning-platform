'use client'

import { cn } from '@/lib/utils'
import { ErrorState } from '@/components/ui/error-state'
import { MobileTakeover } from '../shared/MobileTakeover'
import { InboxList } from './InboxList'
import { MessageThreadPanel } from './MessageThreadPanel'
import { OperatorJobThreadPane } from './OperatorJobThreadPane'
import { ContextPanel } from './ContextPanel'
import type { OperatorMessagesViewProps } from './messages-types'

export function OperatorMessagesView(props: OperatorMessagesViewProps) {
  if (props.error) {
    return <ErrorState title="Couldn't load messages" onRetry={props.onRetry} />;
  }
  // Office thread (?c=) OR read-only job thread (?job=). Mutually exclusive.
  const hasSelection = !!props.selectedId || !!props.selectedJob

  const composerProps = {
    draft: props.draft,
    onDraftChange: props.onDraftChange,
    pendingFiles: props.pendingFiles,
    onAddFiles: props.onAddFiles,
    onRemoveFile: props.onRemoveFile,
    stagedBooking: props.stagedBooking,
    attachableBookings: props.attachableBookings,
    onStageBooking: props.onStageBooking,
    onClearStagedBooking: props.onClearStagedBooking,
    onSend: props.onSend,
    sending: props.sending,
    isMobile: props.isMobile,
  }

  const renderThread = (onBack?: () => void) =>
    props.selectedJob ? (
      <OperatorJobThreadPane
        appointmentId={props.selectedJob.appointmentId}
        title={props.selectedJob.title}
        dateLabel={props.selectedJob.dateLabel}
        cleanerId={props.selectedJob.cleanerId}
        onBack={onBack}
      />
    ) : (
    <MessageThreadPanel
      hasSelection={!!props.selectedId}
      conversationKey={props.selectedId}
      title={props.threadTitle}
      role={props.threadRole}
      initials={props.threadInitials}
      avatarUrl={props.threadAvatarUrl}
      detailsOpen={props.detailsOpen}
      onToggleDetails={props.onToggleDetails}
      onBack={onBack}
      onRequestDelete={() => props.selectedId && props.onRequestDelete(props.selectedId)}
      messages={props.messages}
      loading={props.threadLoading}
      hasMore={props.hasMore}
      isLoadingMore={props.isLoadingMore}
      onLoadMore={props.onLoadMore}
      messagesEndRef={props.messagesEndRef}
      onOpenBooking={props.onOpenBooking}
      composer={composerProps}
    />
  )

  return (
    <div
      className={cn(
        // The whole Messages tab is one white surface. On mobile it breaks out of
        // the shell gutters/padding and fills from below the top bar to the bottom
        // nav (no floating card). On desktop it is an anchored, flattened two-pane.
        'flex flex-col bg-card',
        '-mx-4 -mt-5 -mb-28 h-[calc(100dvh-4rem-60px-env(safe-area-inset-bottom))]',
        'lg:mx-0 lg:mt-0 lg:mb-0 lg:h-[calc(100dvh-9rem)] lg:bg-transparent',
      )}
    >
      {/* Title (no conversation count) */}
      <h1 className="shrink-0 px-4 pb-2 pt-3 text-2xl font-extrabold tracking-tight lg:px-0">
        Messages
      </h1>

      {/* Desktop two-pane console (flattened white panel); mobile = inbox only */}
      <div
        className={cn(
          'flex min-h-0 flex-1 overflow-hidden',
          'lg:rounded-card lg:border lg:border-border lg:bg-card',
        )}
      >
        {/* Inbox: full width on mobile, fixed column on desktop */}
        <div className="flex min-h-0 w-full flex-col lg:w-[360px] lg:shrink-0 lg:border-r lg:border-border">
          <InboxList
            rows={props.rows}
            unreadTotal={props.unreadTotal}
            search={props.search}
            onSearchChange={props.onSearchChange}
            unreadOnly={props.unreadOnly}
            onUnreadOnlyChange={props.onUnreadOnlyChange}
            roleFilter={props.roleFilter}
            roleOptions={props.roleOptions}
            onRoleFilterChange={props.onRoleFilterChange}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            jobRows={props.jobRows}
            selectedJobId={props.selectedJobId}
            onSelectJob={props.onSelectJob}
            onRequestDelete={props.onRequestDelete}
            onNewMessage={props.onNewMessage}
            loading={props.inboxLoading}
          />
        </div>

        {/* Desktop thread (no back button; lives beside the list) */}
        <div className="hidden min-w-0 flex-1 lg:block">{renderThread(undefined)}</div>

        {/* Desktop About column (office threads only; job threads have no operator context) */}
        {!props.isMobile && props.detailsOpen && !!props.selectedId && (
          <ContextPanel
            isMobile={false}
            open={props.detailsOpen}
            onOpenChange={(o) => {
              if (!o) props.onToggleDetails()
            }}
            context={props.context}
            onOpenBooking={props.onOpenBooking}
            onViewProfile={props.onViewProfile}
            onNewBooking={props.onNewBooking}
            onCopy={props.onCopy}
          />
        )}
      </div>

      {/* Mobile: full-screen thread takeover that slides in over the whole shell */}
      {props.isMobile && hasSelection && (
        <MobileTakeover
          onClosed={() => (props.selectedJob ? props.onSelectJob('') : props.onSelect(''))}
          ariaLabel="Conversation"
          desktopHidden
          keyboardAware
        >
          {(close) => renderThread(close)}
        </MobileTakeover>
      )}

      {/* Mobile About: drag-dismiss Drawer */}
      {props.isMobile && (
        <ContextPanel
          isMobile
          open={props.detailsOpen}
          onOpenChange={(o) => {
            if (!o) props.onToggleDetails()
          }}
          context={props.context}
          onOpenBooking={props.onOpenBooking}
          onViewProfile={props.onViewProfile}
          onNewBooking={props.onNewBooking}
          onCopy={props.onCopy}
        />
      )}
    </div>
  )
}
