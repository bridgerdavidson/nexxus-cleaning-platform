'use client'

import { Mail, Phone, UserCircle2, Plus, X, CalendarDays } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { BookingBadge } from './messages-presenters'
import type { ContactBookingVM, ContactContextVM } from './messages-types'

const ROLE_LABEL: Record<string, string> = { homeowner: 'Homeowner', cleaner: 'Cleaner', manager: 'Manager', admin: 'Admin' }

/** Without `onOpen` (viewer lacks can_view_bookings) the row renders as an
 * informational card instead of a button. */
function BookingMini({ b, onOpen }: { b: ContactBookingVM; onOpen?: () => void }) {
  const Tag = onOpen ? 'button' : 'div'
  return (
    <Tag
      {...(onOpen ? { type: 'button' as const, onClick: onOpen } : {})}
      className={
        'mb-2 flex w-full items-center gap-3 rounded-control border border-border bg-card px-2.5 py-2.5 text-left' +
        (onOpen ? ' hover:border-primary/30 hover:shadow-soft-sm' : '')
      }
    >
      <span className="w-10 shrink-0 text-center">
        <span className="block text-base font-extrabold leading-none">{b.dayNum}</span>
        <span className="block text-[10px] font-bold uppercase text-muted-foreground">{b.monthLabel}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">{b.service}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{b.timeLabel}{b.address ? ` · ${b.address}` : ''}</span>
      </span>
      <BookingBadge status={b.status} />
    </Tag>
  )
}

export function ContextPanelBody({
  context, onOpenBooking, onViewProfile, onNewBooking, onCopy, onClose,
}: {
  context: ContactContextVM
  onOpenBooking?: (id: string) => void
  onViewProfile: () => void
  onNewBooking?: () => void
  onCopy: (text: string, label: string) => void
  onClose?: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">About</h4>
        {onClose && <IconButton aria-label="Close details" className="h-8 w-8" onClick={onClose}><X className="size-4" /></IconButton>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="text-center">
          <Avatar className="mx-auto size-16">
            {context.avatarUrl ? <AvatarImage src={context.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-xl">{context.initials}</AvatarFallback>
          </Avatar>
          <div className="mt-2.5 text-base font-extrabold">{context.name}</div>
          <span className="mt-1.5 inline-block rounded-pill bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {ROLE_LABEL[context.role] ?? context.role}
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {context.email && (
            <button type="button" onClick={() => onCopy(context.email!, 'Email')} className="flex items-center gap-2.5 rounded-control border border-border bg-card px-3 py-2.5 text-left text-[12.5px]">
              <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{context.email}</span><span className="text-[11px] font-bold text-primary">Copy</span>
            </button>
          )}
          {context.phone && (
            <button type="button" onClick={() => onCopy(context.phone!, 'Phone')} className="flex items-center gap-2.5 rounded-control border border-border bg-card px-3 py-2.5 text-left text-[12.5px]">
              <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{context.phone}</span><span className="text-[11px] font-bold text-primary">Copy</span>
            </button>
          )}
        </div>

        <div className="mt-3.5 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={onViewProfile}><UserCircle2 className="size-4" />Profile</Button>
          {context.role === 'homeowner' && onNewBooking && (
            <Button size="sm" className="flex-1 gap-1.5" onClick={onNewBooking}><Plus className="size-4" />New booking</Button>
          )}
        </div>

        {(context.cleaningsCount > 0 || context.lifetimeLabel || context.propertiesCount) && (
          <div className="mt-4 flex overflow-hidden rounded-control border border-border bg-card">
            <Stat v={String(context.cleaningsCount)} l="cleanings" />
            {context.lifetimeLabel && <Stat v={context.lifetimeLabel} l="lifetime" bordered />}
            {context.propertiesCount != null && <Stat v={String(context.propertiesCount)} l="properties" bordered />}
          </div>
        )}

        {context.upcoming.length > 0 && (
          <>
            <SectionLabel>Upcoming</SectionLabel>
            {context.upcoming.map((b) => <BookingMini key={b.appointmentId} b={b} onOpen={onOpenBooking ? () => onOpenBooking(b.appointmentId) : undefined} />)}
          </>
        )}
        {context.recent.length > 0 && (
          <>
            <SectionLabel>Recent</SectionLabel>
            {context.recent.map((b) => <BookingMini key={b.appointmentId} b={b} onOpen={onOpenBooking ? () => onOpenBooking(b.appointmentId) : undefined} />)}
          </>
        )}
        {context.upcoming.length === 0 && context.recent.length === 0 && (
          <div className="mt-6 flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
            <CalendarDays className="size-5" aria-hidden /><span>No bookings for this person.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ v, l, bordered }: { v: string; l: string; bordered?: boolean }) {
  return (
    <div className={`flex-1 px-2 py-2.5 text-center ${bordered ? 'border-l border-border/60' : ''}`}>
      <div className="text-base font-extrabold">{v}</div>
      <div className="text-[10px] text-muted-foreground">{l}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{children}</div>
}

export function ContextPanel(props: {
  context: ContactContextVM | null
  isMobile: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenBooking?: (id: string) => void
  onViewProfile: () => void
  onNewBooking?: () => void
  onCopy: (text: string, label: string) => void
}) {
  if (!props.context) return null
  const body = (
    <ContextPanelBody
      context={props.context}
      onOpenBooking={props.onOpenBooking}
      onViewProfile={props.onViewProfile}
      onNewBooking={props.onNewBooking}
      onCopy={props.onCopy}
      onClose={() => props.onOpenChange(false)}
    />
  )
  if (props.isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={props.onOpenChange}>
        <DrawerContent className="max-h-[85dvh]">{body}</DrawerContent>
      </Drawer>
    )
  }
  // desktop column (rendered only when open by the View)
  return <div className="hidden w-80 shrink-0 border-l border-border bg-muted/20 lg:block">{body}</div>
}
