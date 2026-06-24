import type { UserRole } from '@/types'
import type { BookingStatus, ContactBookingVM } from './messages-types'
import { fmtTime } from './messages-format'

// Structural type — decoupled from AdminAppointment so tests can pass plain objects.
// Field names match AdminAppointment exactly (verified against src/hooks/useAdminData.ts).
export interface AppointmentLike {
  id: string
  homeowner_id?: string | null
  cleaner_id?: string | null
  scheduled_date: string // YYYY-MM-DD
  scheduled_time: string // HH:MM
  status: BookingStatus
  total_price?: number
  service_type?: { name?: string | null } | null
  checklist?: { name?: string | null } | null
  property?: { name?: string | null; address?: string | null; city?: string | null; state?: string | null } | null
}

export interface DeriveContactBookingsOpts {
  today: string // YYYY-MM-DD
  maxUpcoming?: number
  maxRecent?: number
}

function toVM(a: AppointmentLike): ContactBookingVM {
  const d = new Date(`${a.scheduled_date}T00:00:00`)
  return {
    appointmentId: a.id,
    service: a.service_type?.name || a.checklist?.name || 'Cleaning',
    dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    timeLabel: fmtTime(a.scheduled_time),
    address: a.property?.name || a.property?.address || null,
    status: a.status,
    dayNum: String(d.getDate()),
    monthLabel: d.toLocaleDateString('en-US', { month: 'short' }),
  }
}

export function deriveContactBookings(
  contact: { id: string; role: UserRole },
  appts: AppointmentLike[],
  opts: DeriveContactBookingsOpts,
): { upcoming: ContactBookingVM[]; recent: ContactBookingVM[]; all: ContactBookingVM[] } {
  const maxUpcoming = opts.maxUpcoming ?? 4
  const maxRecent = opts.maxRecent ?? 4

  // Only homeowners (customer) and cleaners have bookings tied to them.
  const matches =
    contact.role === 'homeowner'
      ? appts.filter((a) => a.homeowner_id === contact.id)
      : contact.role === 'cleaner'
        ? appts.filter((a) => a.cleaner_id === contact.id)
        : []

  if (matches.length === 0) return { upcoming: [], recent: [], all: [] }

  const all = matches
    .slice()
    .sort((x, y) => y.scheduled_date.localeCompare(x.scheduled_date)) // newest first
    .map(toVM)

  const upcoming = matches
    .filter((a) => a.scheduled_date >= opts.today && a.status !== 'cancelled' && a.status !== 'completed')
    .sort((x, y) => x.scheduled_date.localeCompare(y.scheduled_date)) // soonest first
    .slice(0, maxUpcoming)
    .map(toVM)

  const upcomingIds = new Set(upcoming.map((u) => u.appointmentId))
  const recent = matches
    .filter((a) => !upcomingIds.has(a.id))
    .sort((x, y) => y.scheduled_date.localeCompare(x.scheduled_date)) // newest first
    .slice(0, maxRecent)
    .map(toVM)

  return { upcoming, recent, all }
}
