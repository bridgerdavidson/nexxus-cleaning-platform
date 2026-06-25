import { describe, it, expect } from 'vitest'
import {
  timeAgo, lastMessagePreview, money2, initialsOf, dayLabel,
} from './messages-format'

const NOW = new Date('2026-06-24T18:00:00Z').toISOString()

describe('timeAgo', () => {
  it('shows "now" under a minute', () => {
    expect(timeAgo('2026-06-24T17:59:40Z', NOW)).toBe('now')
  })
  it('shows minutes', () => {
    expect(timeAgo('2026-06-24T17:42:00Z', NOW)).toBe('18m')
  })
  it('shows hours', () => {
    expect(timeAgo('2026-06-24T14:00:00Z', NOW)).toBe('4h')
  })
  it('shows days', () => {
    expect(timeAgo('2026-06-22T18:00:00Z', NOW)).toBe('2d')
  })
  it('shows weeks', () => {
    expect(timeAgo('2026-06-10T18:00:00Z', NOW)).toBe('2w')
  })
})

describe('lastMessagePreview', () => {
  it('returns content directly when there is content', () => {
    expect(lastMessagePreview({ content: 'hello', attachmentCount: 0, isMine: false })).toBe('hello')
  })
  it('prefixes "You:" when isMine', () => {
    expect(lastMessagePreview({ content: 'hi', attachmentCount: 0, isMine: true })).toBe('You: hi')
  })
  it('returns "Photo" for 1 attachment and no content', () => {
    expect(lastMessagePreview({ content: '', attachmentCount: 1, isMine: false })).toBe('Photo')
  })
  it('returns "2 photos" for 2 attachments', () => {
    expect(lastMessagePreview({ content: '', attachmentCount: 2, isMine: false })).toBe('2 photos')
  })
  it('returns empty string when no content and no attachments', () => {
    expect(lastMessagePreview({ content: '', attachmentCount: 0, isMine: false })).toBe('')
  })
})

describe('money2', () => {
  it('formats with dollar sign and 2 decimals', () => {
    expect(money2(1680)).toBe('$1,680.00')
  })
  it('handles zero', () => {
    expect(money2(0)).toBe('$0.00')
  })
})

describe('initialsOf', () => {
  it('returns uppercase initials', () => {
    expect(initialsOf('Jordan', 'Avery')).toBe('JA')
  })
  it('returns "?" for both null', () => {
    expect(initialsOf(null, null)).toBe('?')
  })
})

describe('dayLabel', () => {
  it('labels same day as Today', () => {
    expect(dayLabel('2026-06-24T09:00:00Z', NOW)).toBe('Today')
  })
})
