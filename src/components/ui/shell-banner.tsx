'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ShellBannerTone = 'neutral' | 'info' | 'caution' | 'critical'

const TONES: Record<ShellBannerTone, string> = {
  neutral:  'border-border bg-muted text-foreground',
  info:     'border-info/50 bg-info-50 text-info-700 dark:bg-info/15 dark:text-info',
  caution:  'border-caution/50 bg-caution-50 text-caution-700 dark:bg-caution/15 dark:text-caution',
  critical: 'border-critical/50 bg-critical-50 text-critical-700 dark:bg-critical/15 dark:text-destructive',
}

export interface ShellBannerProps {
  tone: ShellBannerTone
  icon?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  /** Omit to make the banner non-dismissible. */
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}

export function ShellBanner({
  tone, icon, children, actions, onDismiss, dismissLabel = 'Dismiss', className,
}: ShellBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b px-4 py-2',
        'text-center text-sm font-medium',
        TONES[tone],
        className,
      )}
    >
      <span className="inline-flex items-center gap-2">
        {icon ? <span className="shrink-0 [&_svg]:size-4" aria-hidden>{icon}</span> : null}
        {children}
      </span>
      {actions ? <span className="inline-flex items-center gap-2">{actions}</span> : null}
      {onDismiss ? (
        <button
          type="button" onClick={onDismiss} aria-label={dismissLabel}
          className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-pill
                     opacity-70 transition-opacity hover:opacity-100
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
        >
          <X aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
