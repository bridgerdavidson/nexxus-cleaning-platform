'use client'

import { CalendarDays, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import type { ConversationRowVM } from './messages-types'

const ROLE_CHIP: Record<string, string> = {
  homeowner: 'Home',
  cleaner: 'Clean',
  manager: 'Mgr',
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
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
      aria-pressed={active}
      className={cn(
        'group relative flex items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
        'cursor-pointer transition-colors hover:bg-accent/60',
        active && 'bg-accent',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary"
        />
      )}
      <Avatar className="size-10 shrink-0">
        {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
        <AvatarFallback>{row.initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-bold">{row.name}</span>
            <span className="shrink-0 rounded-full bg-secondary/30 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {ROLE_CHIP[row.role] ?? row.role}
            </span>
            {row.hasBooking && (
              <CalendarDays
                className="size-3 shrink-0 text-primary/70"
                aria-label="Has booking"
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{row.timeLabel}</span>
            {row.unreadCount > 0 && (
              <Badge variant="default" className="h-4 min-w-[1rem] rounded-full px-1 py-0 text-[10px] leading-4">
                {row.unreadCount > 99 ? '99+' : row.unreadCount}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="truncate text-[12px] text-muted-foreground">{row.preview}</span>
          <IconButton
            aria-label="Delete conversation"
            className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
