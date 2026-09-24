'use client'

import * as React from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StepperProps {
  value: number
  min: number
  /** null means unbounded above. */
  max: number | null
  onChange: (next: number) => void
  /** Visually hidden accessible name. */
  label: string
  /** Shown beneath the control when value === min. */
  minReason?: string
  disabled?: boolean
  className?: string
}

/** Pure. Returns the value the stepper should move to, or null when the move is refused. */
export function nextStepperValue(
  current: number, delta: 1 | -1, min: number, max: number | null,
): number | null {
  const next = current + delta
  if (next < min) return null
  if (max !== null && next > max) return null
  return next
}

export function Stepper({
  value, min, max, onChange, label, minReason, disabled = false, className,
}: StepperProps) {
  const atMin = value <= min
  const atMax = max !== null && value >= max

  const btn =
    'inline-flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors ' +
    'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4'

  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <div className="inline-flex items-center overflow-hidden rounded-pill border border-border bg-card">
        <button
          type="button" className={btn}
          onClick={() => {
            const next = nextStepperValue(value, -1, min, max)
            if (next !== null) onChange(next)
          }}
          disabled={disabled || atMin} aria-label={`Decrease ${label}`}
        >
          <Minus aria-hidden />
        </button>
        <span
          role="spinbutton" aria-label={label} aria-valuenow={value}
          aria-valuemin={min} {...(max !== null ? { 'aria-valuemax': max } : {})}
          tabIndex={0}
          className="min-w-10 px-1 text-center text-sm font-bold tabular-nums text-foreground
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'ArrowUp') {
              const next = nextStepperValue(value, 1, min, max)
              if (next !== null) { e.preventDefault(); onChange(next) }
            }
            if (e.key === 'ArrowDown') {
              const next = nextStepperValue(value, -1, min, max)
              if (next !== null) { e.preventDefault(); onChange(next) }
            }
          }}
        >
          {value}
        </span>
        <button
          type="button" className={btn}
          onClick={() => {
            const next = nextStepperValue(value, 1, min, max)
            if (next !== null) onChange(next)
          }}
          disabled={disabled || atMax} aria-label={`Increase ${label}`}
        >
          <Plus aria-hidden />
        </button>
      </div>
      {atMin && minReason ? (
        <p className="text-xs text-muted-foreground">{minReason}</p>
      ) : null}
    </div>
  )
}
