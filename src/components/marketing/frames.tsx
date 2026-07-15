import * as React from 'react'
import { cn } from '@/lib/utils'
import { Bell, Search, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

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

/** Phone-shell wrapper for mobile vignettes. Supplies the shell, the top bar,
 *  and the bottom nav; the CONSUMER supplies the box via className (both width
 *  and height), because the two callers want different proportions.
 *
 *  The top bar deliberately shows a search icon, which the real CleanerTopBar /
 *  HomeownerTopBar do NOT have today ("No global search (operator-only)").
 *  That divergence is intentional and forward-looking, not a bug to fix back.
 *  See docs/superpowers/specs/2026-07-15-flow-showcase-chrome-design.md.
 */
export function PhoneFrame({
  initials,
  tabs,
  className,
  children,
}: {
  initials: string
  tabs: LucideIcon[]
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft-lg',
        className,
      )}
    >
      <div className="flex flex-none items-center gap-2 border-b border-border bg-card px-3 py-2.5" aria-hidden>
        <Search className="size-3.5 text-muted-foreground" />
        <span className="flex-1" />
        <Bell className="size-3.5 text-muted-foreground" />
        <Avatar className="size-4 text-[7px]">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </div>

      <div className="min-h-0 flex-1 bg-background px-3 py-2.5">{children}</div>

      <nav className="flex flex-none border-t border-border bg-card" aria-hidden>
        {tabs.map((Icon, i) => (
          <span key={i} className="relative flex flex-1 items-center justify-center py-2.5">
            {i === 0 ? (
              <span className="absolute left-1/2 top-0 h-0.5 w-4 -translate-x-1/2 rounded-pill bg-brand-600" />
            ) : null}
            <Icon className={cn('size-3.5', i === 0 ? 'text-brand-600' : 'text-muted-foreground')} />
          </span>
        ))}
      </nav>
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
