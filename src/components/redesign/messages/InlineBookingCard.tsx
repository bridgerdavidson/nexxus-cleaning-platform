'use client'

import { CalendarDays } from 'lucide-react'
import { BookingBadge } from './messages-presenters'
import type { InlineBookingVM } from './messages-types'

/** Booking chip attached to a message. Without `onOpen` (viewer lacks
 * can_view_bookings, so the detail sheet is unavailable) it renders as an
 * informational card instead of a button. */
export function InlineBookingCard({
  booking,
  onOpen,
}: {
  booking: InlineBookingVM
  onOpen?: () => void
}) {
  const Tag = onOpen ? 'button' : 'div'
  return (
    <Tag
      {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})}
      className={
        'flex w-full items-center gap-3 rounded-card border border-primary/25 border-l-[3px] border-l-primary bg-card px-3 py-2.5 text-left shadow-soft-sm' +
        (onOpen ? ' transition-colors hover:border-primary/40' : '')
      }
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
        <CalendarDays className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Booking
        </span>
        <span className="block truncate text-[13px] font-bold">
          {booking.found
            ? `${booking.service} · ${booking.dateLabel}, ${booking.timeLabel}`
            : 'View booking'}
        </span>
        {booking.found && (booking.address || booking.cleanerName) && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {[
              booking.address,
              booking.cleanerName ? `Cleaner: ${booking.cleanerName}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </span>
      {booking.found && <BookingBadge status={booking.status} />}
      {onOpen && (
        <span className="hidden shrink-0 text-xs font-bold text-primary sm:inline">Open &rsaquo;</span>
      )}
    </Tag>
  )
}
