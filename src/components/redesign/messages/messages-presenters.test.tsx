import { describe, it, expect } from 'vitest'
import { toInlineBookingVM, toConversationRowVM } from './messages-presenters'

describe('toInlineBookingVM', () => {
  it('builds a full card from an appointment', () => {
    const vm = toInlineBookingVM(
      {
        id: 'a1',
        scheduled_date: '2026-06-27',
        scheduled_time: '14:00',
        status: 'confirmed',
        service_type: { name: 'Deep Clean' },
        property: { name: null, address: '123 Oak St' },
        cleaner_profile: { user_profile: { first_name: 'Wanda', last_name: 'Jacobs' } },
      } as never,
      'a1',
    )
    expect(vm.found).toBe(true)
    expect(vm.service).toBe('Deep Clean')
    expect(vm.cleanerName).toBe('Wanda Jacobs')
    expect(vm.status).toBe('confirmed')
  })
  it('falls back to a minimal card when the appointment is not loaded', () => {
    const vm = toInlineBookingVM(undefined, 'missing-id')
    expect(vm.found).toBe(false)
    expect(vm.appointmentId).toBe('missing-id')
  })
})

describe('toConversationRowVM', () => {
  it('builds preview + unread + booking flag', () => {
    const conv = {
      id: 'c1',
      other_participant: { id: 'u1', first_name: 'Jordan', last_name: 'Avery', email: 'j@x.com', role: 'homeowner', avatar_url: null },
      last_message: { content: 'hello', sender_id: 'u1', appointment_id: 'a1' },
      last_message_attachment_count: 0,
      unread_count: 2,
      last_message_at: '2026-06-24T10:00:00Z',
    }
    const vm = toConversationRowVM(conv as never, 'me')
    expect(vm.name).toBe('Jordan Avery')
    expect(vm.preview).toBe('hello')
    expect(vm.unreadCount).toBe(2)
    expect(vm.hasBooking).toBe(true)
  })
})
