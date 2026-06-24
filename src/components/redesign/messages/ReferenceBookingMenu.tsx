'use client'

import { useState } from 'react'
import { Search, CalendarDays } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { BookingBadge } from './messages-presenters'
import type { ContactBookingVM } from './messages-types'

function PickerBody({ bookings, onPick }: { bookings: ContactBookingVM[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const filtered = bookings.filter((b) =>
    `${b.service} ${b.address ?? ''} ${b.dateLabel}`.toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <div className="flex max-h-[60vh] flex-col">
      <div className="relative p-2">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search bookings"
          className="h-9 pl-9"
          aria-label="Search bookings"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-5" />} title="No bookings for this person" />
        ) : (
          filtered.map((b) => (
            <button
              key={b.appointmentId}
              type="button"
              onClick={() => onPick(b.appointmentId)}
              className="flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left hover:bg-accent"
            >
              <span className="w-9 shrink-0 text-center">
                <span className="block text-base font-extrabold leading-none">{b.dayNum}</span>
                <span className="block text-[9px] font-bold uppercase text-muted-foreground">{b.monthLabel}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{b.service}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {b.timeLabel}
                  {b.address ? ` · ${b.address}` : ''}
                </span>
              </span>
              <BookingBadge status={b.status} />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export function ReferenceBookingMenu({
  bookings,
  onPick,
  isMobile,
  trigger,
}: {
  bookings: ContactBookingVM[]
  onPick: (id: string) => void
  isMobile: boolean
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const handlePick = (id: string) => {
    onPick(id)
    setOpen(false)
  }

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Reference a booking</DrawerTitle>
          </DrawerHeader>
          <PickerBody bookings={bookings} onPick={handlePick} />
          <div className="h-4" />
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[300px] p-0">
        <div className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Reference a booking
        </div>
        <PickerBody bookings={bookings} onPick={handlePick} />
      </PopoverContent>
    </Popover>
  )
}
