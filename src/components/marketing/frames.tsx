import * as React from 'react'
import { cn } from '@/lib/utils'

/** Browser-chrome wrapper for desktop app vignettes. */
export function BrowserFrame({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-card shadow-soft-lg', className)}>
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2.5">
        <span className="size-2.5 rounded-pill bg-warm-300" aria-hidden />
        <span className="size-2.5 rounded-pill bg-warm-300" aria-hidden />
        <span className="size-2.5 rounded-pill bg-warm-300" aria-hidden />
        <span className="ml-2 min-w-0 truncate rounded-pill border border-border bg-card px-3.5 py-0.5 text-xs text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  )
}

/** Phone-shell wrapper for mobile vignettes. */
export function PhoneFrame({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('overflow-hidden rounded-[30px] border border-border bg-card shadow-soft-lg', className)}>
      <div className="grid place-items-center py-2" aria-hidden>
        <span className="h-1.5 w-16 rounded-pill bg-warm-200" />
      </div>
      <div className="bg-background px-3.5 pb-5 pt-1.5">{children}</div>
    </div>
  )
}

/** Slim rail echoing the real OperatorRail at sketch fidelity: light card
 *  surface, one brand-blue active block, muted placeholders. */
export function MiniRail() {
  return (
    <div className="hidden w-11 shrink-0 flex-col items-center gap-2.5 border-r border-border bg-card py-3.5 sm:flex" aria-hidden>
      <span className="mb-1.5 size-6 rounded-chip bg-brand-600" />
      <span className="size-6 rounded-chip bg-accent ring-1 ring-brand-200" />
      <span className="size-6 rounded-chip bg-muted" />
      <span className="size-6 rounded-chip bg-muted" />
      <span className="size-6 rounded-chip bg-muted" />
    </div>
  )
}
