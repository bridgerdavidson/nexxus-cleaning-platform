import * as React from 'react'
import { Clock, CalendarCheck, Loader2, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react'
import type { ConversationWithDetails, MessageWithDetails, UserProfile, UserRole } from '@/types'
import type { AdminAppointment } from '@/hooks/useAdminData'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  timeAgo, lastMessagePreview, fmtTime, money2, initialsOf, dayLabel, weekdayMonthDay,
} from './messages-format'
import { deriveContactBookings } from './deriveContactBookings'
import type {
  BookingStatus, ConversationRowVM, InlineBookingVM, MessageVM, ContactContextVM,
} from './messages-types'

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'positive' | 'caution' | 'critical' | 'info'

export const BOOKING_STATUS_CONFIG: Record<
  BookingStatus,
  { label: string; variant: BadgeVariant; Icon: LucideIcon; spin?: boolean }
> = {
  pending:     { label: 'Pending',     variant: 'caution',    Icon: Clock },
  confirmed:   { label: 'Confirmed',   variant: 'secondary',  Icon: CalendarCheck },
  in_progress: { label: 'In progress', variant: 'default',    Icon: Loader2, spin: true },
  completed:   { label: 'Completed',   variant: 'positive',   Icon: CheckCircle2 },
  cancelled:   { label: 'Cancelled',   variant: 'critical',   Icon: XCircle },
}

export function BookingBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const c = BOOKING_STATUS_CONFIG[status] ?? BOOKING_STATUS_CONFIG.confirmed
  const { Icon } = c
  return (
    <Badge variant={c.variant} className={cn('shrink-0 whitespace-nowrap gap-1', className)}>
      <Icon className={cn('size-3', c.spin && 'motion-safe:animate-spin')} aria-hidden="true" />
      {c.label}
    </Badge>
  )
}

function fullName(p?: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!p) return 'Unknown'
  return `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'
}

export function toConversationRowVM(conv: ConversationWithDetails, currentUserId: string): ConversationRowVM {
  const p = conv.other_participant
  const last = conv.last_message
  const isMine = !!last && last.sender_id === currentUserId
  return {
    id: conv.id,
    participantId: p?.id ?? '',
    name: fullName(p),
    email: (p?.email ?? '').toLowerCase(),
    role: (p?.role as UserRole) ?? 'homeowner',
    initials: initialsOf(p?.first_name, p?.last_name),
    avatarUrl: p?.avatar_url ?? null,
    preview: lastMessagePreview({
      content: last?.content ?? '',
      attachmentCount: conv.last_message_attachment_count ?? 0,
      isMine,
    }),
    timeLabel: conv.last_message_at ? timeAgo(conv.last_message_at) : '',
    unreadCount: conv.unread_count ?? 0,
    hasBooking: !!last?.appointment_id,
    lastMessageAt: conv.last_message_at ?? conv.created_at,
  }
}

export function toInlineBookingVM(appt: AdminAppointment | undefined, appointmentId: string): InlineBookingVM {
  if (!appt) {
    return {
      appointmentId, found: false, service: 'Booking', dateLabel: '', timeLabel: '',
      address: null, cleanerName: null, status: 'confirmed',
    }
  }
  // cleaner_profile.user_profile confirmed against AdminAppointment in useAdminData.ts
  const cleaner = appt.cleaner_profile?.user_profile
  return {
    appointmentId,
    found: true,
    service: appt.service_type?.name || appt.checklist?.name || 'Cleaning',
    dateLabel: weekdayMonthDay(appt.scheduled_date),
    timeLabel: fmtTime(appt.scheduled_time),
    // property.name is a string (not optional) in AdminAppointment, fallback to address
    address: appt.property?.name || appt.property?.address || null,
    cleanerName: cleaner ? fullName(cleaner) : null,
    status: (appt.status as BookingStatus) ?? 'confirmed',
  }
}

export function toMessageVM(
  msg: MessageWithDetails,
  currentUserId: string,
  prev: MessageWithDetails | null,
  getBooking: (appointmentId: string) => InlineBookingVM | null,
): MessageVM {
  const created = msg.created_at
  const prevDay = prev ? dayLabel(prev.created_at) : null
  const thisDay = dayLabel(created)
  return {
    id: msg.id,
    senderId: msg.sender_id,
    isMine: msg.sender_id === currentUserId,
    content: msg.content ?? '',
    timeLabel: timeAgo(created),
    isRead: msg.is_read,
    attachments: (msg.attachments ?? []).map((a) => ({ id: a.id, url: a.file_url })),
    booking: msg.appointment_id ? getBooking(msg.appointment_id) : null,
    createdAt: created,
    dayLabel: thisDay,
    showDayDivider: prevDay !== thisDay,
  }
}

export function toContactContext(
  participant: UserProfile,
  appts: AdminAppointment[],
  opts: { canViewPayments: boolean; today: string },
): ContactContextVM {
  const role = (participant.role as UserRole) ?? 'homeowner'
  // Cast to AppointmentLike-compatible shape (fields match; AdminAppointment is a superset)
  const { upcoming, recent } = deriveContactBookings(
    { id: participant.id, role },
    appts as never,
    { today: opts.today },
  )

  // lifetime + properties only meaningful for a homeowner (customer)
  let lifetimeLabel: string | null = null
  let propertiesCount: number | null = null
  let cleaningsCount = 0
  if (role === 'homeowner') {
    const mine = appts.filter((a) => a.homeowner_id === participant.id)
    cleaningsCount = mine.filter((a) => a.status === 'completed').length
    if (opts.canViewPayments) {
      const sum = mine
        .filter((a) => a.status === 'completed')
        .reduce((acc, a) => acc + Number(a.total_price || 0), 0)
      lifetimeLabel = money2(sum)
    }
    // property.address is a string in AdminAppointment (not optional), use it for dedup
    propertiesCount = new Set(mine.map((a) => a.property?.address).filter(Boolean)).size || null
  } else if (role === 'cleaner') {
    cleaningsCount = appts.filter((a) => a.cleaner_id === participant.id && a.status === 'completed').length
  }

  return {
    id: participant.id,
    name: fullName(participant),
    role,
    initials: initialsOf(participant.first_name, participant.last_name),
    avatarUrl: participant.avatar_url ?? null,
    email: participant.email ?? null,
    phone: participant.phone ?? null,
    cleaningsCount,
    lifetimeLabel,
    propertiesCount,
    upcoming,
    recent,
  }
}

// Re-export all for use in Container
export { deriveContactBookings }
