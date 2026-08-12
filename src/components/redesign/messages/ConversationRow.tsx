'use client'

import { CalendarDays, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
import { InboxRow } from './InboxRow'
import { RolePill } from './messages-pills'
import type { ConversationRowVM } from './messages-types'

/** Operator office-thread inbox row: the InboxRow shell + role pill + hover delete. */
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
      <InboxRow
        active={active}
        onSelect={onSelect}
        leading={
          <Avatar className="size-11 shrink-0">
            {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
            <AvatarFallback>{row.initials}</AvatarFallback>
          </Avatar>
        }
        name={row.name}
        namePill={<RolePill role={row.role} />}
        timeLabel={row.timeLabel}
        preview={row.preview}
        previewAccessory={
          row.hasBooking ? (
            <CalendarDays
              className="size-3.5 shrink-0 text-primary/70"
              aria-label="Has a linked booking"
            />
          ) : undefined
        }
        unreadCount={row.unreadCount}
      />
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
