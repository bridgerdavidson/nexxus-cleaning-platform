import { describe, it, expect } from 'vitest'
import {
  timeAgo, lastMessagePreview, money2, initialsOf, initialsFromFullName, dayLabel, monthDay,
  weekdayMonthDay, fmtTime,
} from './messages-format'

// Pin the timezone: dayLabel uses local-time day boundaries, so absolute
// expectations are only stable under a fixed zone (same convention as
// jobTranscript.test.ts). Set at module load, before any `it` runs.
process.env.TZ = 'UTC'

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

describe('initialsFromFullName', () => {
  it('takes first + last word initials', () => {
    expect(initialsFromFullName('Wanda Jacobs')).toBe('WJ')
    expect(initialsFromFullName('Mary Jo van der Berg')).toBe('MB')
  })
  it('uses two letters of a single name', () => {
    expect(initialsFromFullName('Cher')).toBe('CH')
  })
  it('returns "?" for empty input', () => {
    expect(initialsFromFullName('  ')).toBe('?')
  })
})

describe('dayLabel', () => {
  it('labels same day as Today', () => {
    expect(dayLabel('2026-06-24T09:00:00Z', NOW)).toBe('Today')
  })
  it('labels the previous day as Yesterday', () => {
    expect(dayLabel('2026-06-23T18:00:00Z', NOW)).toBe('Yesterday')
  })
  it('falls back to month + day for older dates', () => {
    expect(dayLabel('2026-06-10T18:00:00Z', NOW)).toBe('Jun 10')
  })
})

describe('monthDay', () => {
  it('formats a YYYY-MM-DD as month + day', () => {
    expect(monthDay('2026-06-29')).toBe('Jun 29')
  })
  it('returns empty for missing or invalid input', () => {
    expect(monthDay(undefined)).toBe('')
    expect(monthDay(null)).toBe('')
    expect(monthDay('not-a-date')).toBe('')
  })
})

describe('weekdayMonthDay', () => {
  it('formats a YYYY-MM-DD with the weekday', () => {
    expect(weekdayMonthDay('2026-06-27')).toBe('Sat, Jun 27')
  })
})

describe('fmtTime', () => {
  it('formats a bare HH:MM as a 12-hour clock time', () => {
    expect(fmtTime('14:30')).toBe('2:30 PM')
  })
  it('formats an ISO timestamp as a 12-hour clock time', () => {
    expect(fmtTime('2026-06-24T09:05:00Z')).toBe('9:05 AM')
  })
})
