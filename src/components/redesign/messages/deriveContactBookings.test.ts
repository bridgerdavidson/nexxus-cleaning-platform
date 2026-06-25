import { describe, it, expect } from 'vitest'
import { deriveContactBookings, type AppointmentLike } from './deriveContactBookings'

function appt(o: Partial<AppointmentLike>): AppointmentLike {
  return {
    id: o.id ?? 'a1',
    homeowner_id: o.homeowner_id,
    cleaner_id: o.cleaner_id,
    scheduled_date: o.scheduled_date ?? '2026-06-27',
    scheduled_time: o.scheduled_time ?? '14:00',
    status: o.status ?? 'confirmed',
    total_price: o.total_price ?? 120,
    service_type: o.service_type ?? { name: 'Deep Clean' },
    checklist: o.checklist ?? null,
    property: o.property ?? { name: null, address: '123 Oak St', city: 'SLC', state: 'UT' },
  }
}

const TODAY = '2026-06-24'

describe('deriveContactBookings', () => {
  it('selects a homeowner contact bookings by homeowner_id', () => {
    const appts = [
      appt({ id: 'mine', homeowner_id: 'h1' }),
      appt({ id: 'other', homeowner_id: 'h2' }),
    ]
    const r = deriveContactBookings({ id: 'h1', role: 'homeowner' }, appts, { today: TODAY })
    expect(r.all.map(b => b.appointmentId)).toEqual(['mine'])
  })

  it('selects a cleaner contact bookings by cleaner_id', () => {
    const appts = [appt({ id: 'job', cleaner_id: 'cl1', homeowner_id: 'h9' })]
    const r = deriveContactBookings({ id: 'cl1', role: 'cleaner' }, appts, { today: TODAY })
    expect(r.all.map(b => b.appointmentId)).toEqual(['job'])
  })

  it('splits upcoming (future, not cancelled) soonest-first and recent newest-first', () => {
    const appts = [
      appt({ id: 'past', homeowner_id: 'h1', scheduled_date: '2026-06-20', status: 'completed' }),
      appt({ id: 'soon', homeowner_id: 'h1', scheduled_date: '2026-06-27', status: 'confirmed' }),
      appt({ id: 'later', homeowner_id: 'h1', scheduled_date: '2026-07-04', status: 'confirmed' }),
      appt({ id: 'cxl', homeowner_id: 'h1', scheduled_date: '2026-06-30', status: 'cancelled' }),
    ]
    const r = deriveContactBookings({ id: 'h1', role: 'homeowner' }, appts, { today: TODAY })
    expect(r.upcoming.map(b => b.appointmentId)).toEqual(['soon', 'later'])
    expect(r.recent.map(b => b.appointmentId)).toEqual(['cxl', 'past']) // past/cancelled, newest first
  })

  it('overflow future-confirmed bookings beyond maxUpcoming do not leak into recent', () => {
    const appts = [
      appt({ id: 'soon', homeowner_id: 'h1', scheduled_date: '2026-06-27', status: 'confirmed' }),
      appt({ id: 'later', homeowner_id: 'h1', scheduled_date: '2026-07-10', status: 'confirmed' }),
    ]
    const r = deriveContactBookings({ id: 'h1', role: 'homeowner' }, appts, { today: TODAY, maxUpcoming: 1 })
    expect(r.upcoming.map(b => b.appointmentId)).toEqual(['soon'])
    expect(r.recent).toEqual([]) // 'later' is future+confirmed — must not appear in recent
  })

  it('returns empty for a non-customer contact (manager)', () => {
    const appts = [appt({ id: 'x', homeowner_id: 'h1' })]
    const r = deriveContactBookings({ id: 'm1', role: 'manager' }, appts, { today: TODAY })
    expect(r.all).toEqual([])
    expect(r.upcoming).toEqual([])
    expect(r.recent).toEqual([])
  })
})
