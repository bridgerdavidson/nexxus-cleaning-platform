'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { InboxList } from './InboxList'
import { MessageThreadPanel } from './MessageThreadPanel'
import { ContextPanel } from './ContextPanel'
import type { OperatorMessagesViewProps } from './messages-types'

/**
 * Mobile thread takeover: a full-screen surface that slides in from the right
 * over the entire shell (top bar, bottom nav, FAB) so the conversation gets the
 * whole screen, like a native messaging app. Mirrors the legacy slide behavior.
 * `onClosed` runs after the slide-out completes (it deselects the conversation).
 */
function MobileThreadOverlay({
  onClosed,
  children,
}: {
  onClosed: () => void
  children: (close: () => void) => React.ReactNode
}) {
  const [shown, setShown] = useState(false)
  const closingRef = useRef(false)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setShown(false)
    window.setTimeout(onClosed, 300)
  }, [onClosed])
  // Keep the latest close reachable from mount-only effects without re-running them.
  const closeRef = useRef(close)
  closeRef.current = close

  // Slide in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Lock background scroll + move focus into the takeover ONCE when it opens.
  // This MUST be mount-only: re-running it on every render would re-call
  // .focus() and steal focus from the composer on each keystroke, which
  // collapses the on-screen keyboard (you'd have to re-tap after every letter).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  // Close on Escape (bind once; call the latest close via a ref).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the composer above the on-screen keyboard on iOS: the visual viewport
  // shrinks when the keyboard opens but a `fixed`/`dvh` layout does not, so we
  // lift the overlay's bottom by the keyboard height.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      ref.current?.style.setProperty('--kbd', `${kb}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), var(--kbd, 0px))' }}
      className={cn(
        'redesign-overlay fixed inset-0 z-50 flex flex-col bg-card outline-none lg:hidden',
        'pt-[env(safe-area-inset-top)]',
        'transition-transform duration-300 ease-out motion-reduce:transition-none',
        shown ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">{children(close)}</div>
    </div>
  )
}

export function OperatorMessagesView(props: OperatorMessagesViewProps) {
  const hasSelection = !!props.selectedId

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

  const renderThread = (onBack?: () => void) => (
    <MessageThreadPanel
      hasSelection={hasSelection}
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
        'lg:mx-0 lg:mt-0 lg:mb-0 lg:h-[calc(100dvh-9rem)] lg:max-w-[1700px] lg:bg-transparent',
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

        {/* Desktop thread (no back button; lives beside the list) */}
        <div className="hidden min-w-0 flex-1 lg:block">{renderThread(undefined)}</div>

        {/* Desktop About column */}
        {!props.isMobile && props.detailsOpen && hasSelection && (
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
        <MobileThreadOverlay onClosed={() => props.onSelect('')}>
          {(close) => renderThread(close)}
        </MobileThreadOverlay>
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
