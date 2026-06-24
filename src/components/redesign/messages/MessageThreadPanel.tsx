'use client'

import { useEffect, useRef } from 'react'
import { ArrowLeft, Info, MoreVertical, MessageSquare, Loader2, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import type { MessageVM } from './messages-types'

const ROLE_LABEL: Record<string, string> = {
  homeowner: 'Homeowner',
  cleaner: 'Cleaner',
  manager: 'Manager',
  admin: 'Admin',
}

export function MessageThreadPanel(props: {
  hasSelection: boolean
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
  onOpenBooking: (id: string) => void
  // composer
  composer: React.ComponentProps<typeof MessageComposer>
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const countRef = useRef(0)

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

  // auto-scroll to bottom when a NEW message arrives and we are near the bottom
  useEffect(() => {
    const grew = props.messages.length > countRef.current
    countRef.current = props.messages.length
    const sc = scrollRef.current
    if (!grew || !sc) return
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 150
    if (nearBottom) props.messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [props.messages.length, props.messagesEndRef])

  if (!props.hasSelection) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<MessageSquare className="size-5" />}
          title="Select a conversation"
          description="Choose a conversation on the left to read and reply."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-background to-muted/30">
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-border/60 bg-background px-3 py-2.5">
        {props.onBack && (
          <IconButton
            aria-label="Back to conversations"
            className="h-9 w-9 lg:hidden"
            onClick={props.onBack}
          >
            <ArrowLeft className="size-5" />
          </IconButton>
        )}
        <Avatar className="size-9 shrink-0">
          {props.avatarUrl ? <AvatarImage src={props.avatarUrl} alt="" /> : null}
          <AvatarFallback>{props.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{props.title}</div>
          {props.role && (
            <div className="text-xs text-muted-foreground">
              {ROLE_LABEL[props.role] ?? props.role}
            </div>
          )}
        </div>
        <Button
          variant={props.detailsOpen ? 'secondary' : 'outline'}
          size="sm"
          onClick={props.onToggleDetails}
          className="gap-1.5"
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
      </div>

      {/* Message scroll area */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
      >
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {props.isLoadingMore && (
          <div className="flex justify-center py-1">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {props.loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton
                key={i}
                className={cn('h-10 rounded-card', i % 2 ? 'w-2/3 self-end' : 'w-1/2 self-start')}
              />
            ))}
          </div>
        ) : props.messages.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title="No messages yet"
            description="Say hello to start the conversation."
          />
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
