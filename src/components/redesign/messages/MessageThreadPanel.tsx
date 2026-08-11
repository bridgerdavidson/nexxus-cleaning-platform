'use client'

import { useEffect, useRef } from 'react'
import { Info, MoreVertical, MessageSquare, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { ThreadHeader } from './ThreadHeader'
import { LoadMoreSpinner, ThreadEmptyState, ThreadSkeleton } from './ThreadStates'
import { ROLE_LABEL } from './messages-pills'
import type { MessageVM } from './messages-types'

export function MessageThreadPanel(props: {
  hasSelection: boolean
  conversationKey: string | null
  title: string
  role: string | null
  initials: string
  avatarUrl: string | null
  detailsOpen: boolean
  onToggleDetails: () => void
  onBack?: () => void
  onRequestDelete: () => void
  messages: MessageVM[]
  loading: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  messagesEndRef: React.RefObject<HTMLDivElement>
  onOpenBooking?: (id: string) => void
  // composer
  composer: React.ComponentProps<typeof MessageComposer>
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const lastIdRef = useRef<string | null>(null)
  const didInitialScrollRef = useRef(false)

  // Reset initial-scroll flag whenever the conversation changes so the first
  // batch of messages for the new thread always jumps to the bottom.
  useEffect(() => {
    didInitialScrollRef.current = false
    lastIdRef.current = null
  }, [props.conversationKey])

  // paging: observe the top sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !props.hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && props.hasMore && !props.isLoadingMore) props.onLoadMore()
      },
      { root: scrollRef.current, rootMargin: '200px 0px 0px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [props.hasMore, props.isLoadingMore, props.onLoadMore])

  // auto-scroll to bottom on initial load (unconditional); on subsequent new
  // trailing messages only when already near the bottom (don't yank the user up
  // if they are paging back through history).
  useEffect(() => {
    const last = props.messages[props.messages.length - 1]
    if (!last) return
    if (!didInitialScrollRef.current) {
      // First render of this conversation's messages: jump to latest immediately.
      didInitialScrollRef.current = true
      lastIdRef.current = last.id
      props.messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
      return
    }
    const isNew = last.id !== lastIdRef.current
    lastIdRef.current = last.id
    if (!isNew) return
    const sc = scrollRef.current
    if (!sc) return
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 150
    if (nearBottom) props.messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [props.messages, props.messagesEndRef])

  if (!props.hasSelection) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<MessageSquare />}
          title="Select a conversation"
          description="Choose a conversation on the left to read and reply."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Thread header (white; the warm message list below separates the white bubbles) */}
      <ThreadHeader
        onBack={props.onBack}
        backHiddenOnDesktop
        backAriaLabel="Back to conversations"
        avatar={{ url: props.avatarUrl, initials: props.initials }}
        title={props.title}
        subtitle={props.role ? ROLE_LABEL[props.role] ?? props.role : undefined}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={props.onToggleDetails}
              aria-pressed={props.detailsOpen}
              className={cn(
                'gap-1.5',
                props.detailsOpen && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
              )}
            >
              <Info className="size-4" />
              Details
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Conversation actions" className="h-9 w-9">
                  <MoreVertical className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem destructive onSelect={props.onRequestDelete}>
                  <Trash2 className="size-4" />
                  Delete conversation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/* Message scroll area */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4"
      >
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {props.isLoadingMore && <LoadMoreSpinner />}
        {/* Bottom-anchor: this spacer grows to push a short thread down to the
            composer (like iMessage/WhatsApp) and collapses to 0 once messages
            overflow, so normal scrolling is unaffected. */}
        <div aria-hidden className="flex-1" />
        {props.loading ? (
          <ThreadSkeleton />
        ) : props.messages.length === 0 ? (
          <ThreadEmptyState title="No messages yet" body="Say hello to start the conversation." />
        ) : (
          props.messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-3">
              {m.showDayDivider && (
                <div className="self-center text-[11px] font-semibold text-muted-foreground">
                  {m.dayLabel}
                </div>
              )}
              <MessageBubble message={m} onOpenBooking={props.onOpenBooking} />
            </div>
          ))
        )}
        <div ref={props.messagesEndRef} aria-hidden />
      </div>

      <MessageComposer {...props.composer} />
    </div>
  )
}
