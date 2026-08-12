// Pure formatters for the Messages screen. No React, no I/O. Mirrors money/date
// helpers used by other redesign screens but kept local to avoid cross-feature imports.

function nowMs(now?: string): number {
  return now ? new Date(now).getTime() : Date.now()
}

export function timeAgo(iso: string, now?: string): string {
  const diffMs = nowMs(now) - new Date(iso).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return `${Math.floor(diffDay / 7)}w`
}

export function lastMessagePreview({
  content,
  attachmentCount,
  isMine,
}: {
  content: string
  attachmentCount: number
  isMine: boolean
}): string {
  const text = content?.trim() ?? ''
  if (!text && attachmentCount > 0) {
    return attachmentCount === 1 ? 'Photo' : `${attachmentCount} photos`
  }
  if (!text) return ''
  return isMine ? `You: ${text}` : text
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function fmtTime(value: string): string {
  // value may be "HH:MM" (scheduled_time) or a full ISO string
  const d = /^\d{1,2}:\d{2}/.test(value) ? new Date(`2000-01-01T${value}`) : new Date(value)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function money2(n: number): string {
  return `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function initialsOf(first: string | null | undefined, last: string | null | undefined): string {
  const a = (first || '').trim()
  const b = (last || '').trim()
  const out = `${a.charAt(0)}${b.charAt(0)}`.toUpperCase()
  return out || '?'
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function dayLabel(iso: string, now?: string): string {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(new Date(nowMs(now))) - startOfDay(d)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Jun 29" from a YYYY-MM-DD (parsed at local midnight); '' when missing/invalid. */
export function monthDay(ymd?: string | null): string {
  if (!ymd) return ''
  const d = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Sat, Jun 27" from a YYYY-MM-DD (parsed at local midnight). */
export function weekdayMonthDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
