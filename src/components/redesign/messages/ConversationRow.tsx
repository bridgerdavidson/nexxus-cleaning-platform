'use client'

import { CalendarDays, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import type { ConversationRowVM } from './messages-types'

const ROLE_LABEL: Record<string, string> = {
  homeowner: 'Homeowner',
  cleaner: 'Cleaner',
  manager: 'Manager',
  admin: 'Admin',
}

export function ConversationRow({
  row,
  active,
  onSelect,
  onDelete,
}: {
  row: ConversationRowVM
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={cn(
          'relative flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
          'touch-manipulation transition-colors',
          // active = touch press feedback; hover is gated to hover-capable pointers
          // (tailwind future.hoverOnlyWhenSupported) so it never sticks on tap.
          'active:bg-accent hover:bg-accent/60',
          active && 'bg-accent',
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary"
          />
        )}
        <Avatar className="size-11 shrink-0">
          {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
          <AvatarFallback>{row.initials}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          {/* line 1: name + role + time */}
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-bold leading-tight">
              {row.name}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/65">
              {ROLE_LABEL[row.role] ?? row.role}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {row.timeLabel}
            </span>
          </span>
          {/* line 2: preview + booking glyph + unread */}
          <span className="mt-1 flex items-center gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px]',
                row.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {row.preview}
            </span>
            {row.hasBooking && (
              <CalendarDays
                className="size-3.5 shrink-0 text-primary/70"
                aria-label="Has a linked booking"
              />
            )}
            {row.unreadCount > 0 && (
              <Badge
                variant="default"
                className="h-5 min-w-[1.25rem] shrink-0 justify-center rounded-full px-1.5 py-0 text-[10px] leading-5"
              >
                {row.unreadCount > 99 ? '99+' : row.unreadCount}
              </Badge>
            )}
          </span>
        </span>
      </button>
      {/* Desktop-only hover delete: absolutely positioned so it costs no row width;
          group-hover is gated to hover-capable pointers, so it never shows on touch. */}
      <IconButton
        aria-label="Delete conversation"
        className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 bg-card/95 opacity-0 shadow-soft-sm transition-opacity hover:opacity-100 group-hover:opacity-100 lg:flex"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className="size-4" />
      </IconButton>
    </div>
  )
}
