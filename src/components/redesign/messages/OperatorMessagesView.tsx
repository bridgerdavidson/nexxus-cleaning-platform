'use client'

import { cn } from '@/lib/utils'
import { InboxList } from './InboxList'
import { MessageThreadPanel } from './MessageThreadPanel'
import { ContextPanel } from './ContextPanel'
import type { OperatorMessagesViewProps } from './messages-types'

export function OperatorMessagesView(props: OperatorMessagesViewProps) {
  const hasSelection = !!props.selectedId

  return (
    <div className="mx-0 flex h-[calc(100dvh-9rem)] w-full max-w-[1700px] flex-col">
      {/* header */}
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Messages</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {props.totalConversations} conversation{props.totalConversations === 1 ? '' : 's'}
            {props.unreadTotal > 0 && (
              <>
                {' '}
                &middot;{' '}
                <span className="font-bold text-primary">{props.unreadTotal} unread</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* console: full-bleed flush surface on mobile (no floating card); a bordered,
          rounded console on desktop. -mx-4 cancels the shell's mobile gutters so the
          list runs edge-to-edge like a native messaging app. */}
      <div className="-mx-4 flex min-h-0 flex-1 overflow-hidden bg-card lg:mx-0 lg:rounded-card lg:border lg:border-border lg:shadow-soft-md">
        {/* inbox pane: always visible on desktop; hidden on mobile when a thread is open */}
        <div
          className={cn(
            'lg:w-[360px] shrink-0 border-r border-border/60',
            hasSelection && 'hidden lg:block',
          )}
        >
          <InboxList
            rows={props.rows}
            totalConversations={props.totalConversations}
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
            onRequestDelete={props.onRequestDelete}
            onNewMessage={props.onNewMessage}
            loading={props.inboxLoading}
          />
        </div>

        {/* thread: full width on mobile when selected; flex on desktop */}
        <div className={cn('min-w-0 flex-1', !hasSelection && 'hidden lg:block')}>
          <MessageThreadPanel
            hasSelection={hasSelection}
            conversationKey={props.selectedId}
            title={props.threadTitle}
            role={props.threadRole}
            initials={props.threadInitials}
            avatarUrl={props.threadAvatarUrl}
            detailsOpen={props.detailsOpen}
            onToggleDetails={props.onToggleDetails}
            onBack={() => props.onSelect('')}
            onRequestDelete={() => props.selectedId && props.onRequestDelete(props.selectedId)}
            messages={props.messages}
            loading={props.threadLoading}
            hasMore={props.hasMore}
            isLoadingMore={props.isLoadingMore}
            onLoadMore={props.onLoadMore}
            messagesEndRef={props.messagesEndRef}
            onOpenBooking={props.onOpenBooking}
            composer={{
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
            }}
          />
        </div>

        {/* About panel: mobile = Drawer overlay (always mounted when context exists),
            desktop = side column only when detailsOpen + hasSelection */}
        {props.isMobile ? (
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
        ) : (
          props.detailsOpen &&
          hasSelection && (
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
          )
        )}
      </div>
    </div>
  )
}
