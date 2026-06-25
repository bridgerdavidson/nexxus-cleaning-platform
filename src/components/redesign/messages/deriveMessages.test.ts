import { describe, it, expect } from 'vitest'
import { deriveMessages, unreadTotal } from './deriveMessages'
import type { ConversationRowVM } from './messages-types'

function row(o: Partial<ConversationRowVM>): ConversationRowVM {
  return {
    id: o.id ?? 'c1',
    participantId: o.participantId ?? 'u1',
    name: o.name ?? 'Jordan Avery',
    email: o.email ?? 'jordan@example.com',
    role: o.role ?? 'homeowner',
    initials: 'JA',
    avatarUrl: null,
    preview: o.preview ?? 'hi',
    timeLabel: '2m',
    unreadCount: o.unreadCount ?? 0,
    hasBooking: false,
    lastMessageAt: o.lastMessageAt ?? '2026-06-24T10:00:00Z',
  }
}

describe('deriveMessages', () => {
  const rows = [
    row({ id: 'a', name: 'Jordan Avery', role: 'homeowner', unreadCount: 2, lastMessageAt: '2026-06-24T10:00:00Z' }),
    row({ id: 'b', name: 'Wanda Jacobs', email: 'wanda@clean.co', role: 'cleaner', unreadCount: 0, lastMessageAt: '2026-06-24T12:00:00Z' }),
    row({ id: 'c', name: 'Marcus Lee', role: 'manager', unreadCount: 1, lastMessageAt: '2026-06-24T08:00:00Z' }),
  ]

  it('sorts by lastMessageAt desc', () => {
    expect(deriveMessages(rows, { search: '', unreadOnly: false, roleFilter: 'all' }).map(r => r.id)).toEqual(['b', 'a', 'c'])
  })
  it('filters by name (case-insensitive)', () => {
    expect(deriveMessages(rows, { search: 'wanda', unreadOnly: false, roleFilter: 'all' }).map(r => r.id)).toEqual(['b'])
  })
  it('filters by email', () => {
    expect(deriveMessages(rows, { search: 'clean.co', unreadOnly: false, roleFilter: 'all' }).map(r => r.id)).toEqual(['b'])
  })
  it('filters by role', () => {
    expect(deriveMessages(rows, { search: '', unreadOnly: false, roleFilter: 'cleaner' }).map(r => r.id)).toEqual(['b'])
  })
  it('filters unread only', () => {
    expect(deriveMessages(rows, { search: '', unreadOnly: true, roleFilter: 'all' }).map(r => r.id)).toEqual(['a', 'c'])
  })
  it('does not mutate input', () => {
    const copy = [...rows]
    deriveMessages(rows, { search: '', unreadOnly: false, roleFilter: 'all' })
    expect(rows).toEqual(copy)
  })
})

describe('unreadTotal', () => {
  it('sums unread counts', () => {
    expect(unreadTotal([row({ unreadCount: 2 }), row({ unreadCount: 1 }), row({ unreadCount: 0 })])).toBe(3)
  })
})
