import * as React from 'react'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import { Bell, CalendarDays, CreditCard, Home, Plus, Search, Settings, Users, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

/** Browser-chrome wrapper for desktop app vignettes.
 *  `appBar` adds the operator top bar (search / New booking / bell / avatar)
 *  beneath the browser chrome, mirroring OperatorTopBar at sketch scale.
 *  Off by default: CapabilityExplorer wants browser chrome only.
 */
export function BrowserFrame({
  label,
  appBar = false,
  className,
  children,
}: {
  label: string
  appBar?: boolean
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

      {appBar ? (
        <div className="flex items-center gap-2 border-b border-border bg-card px-2.5 py-2" aria-hidden>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-pill border border-border bg-background px-2.5 py-1">
            <Search className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-[9px] text-muted-foreground">Search bookings, customers, cleaners...</span>
            <span className="ml-auto shrink-0 rounded-chip bg-muted px-1.5 py-0.5 text-[8px] font-semibold leading-none text-muted-foreground">
              ⌘K
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-chip bg-brand-600 px-2 py-1 text-[9px] font-bold text-white">
            <Plus className="size-2.5" />
            New booking
          </span>
          <Bell className="size-3.5 shrink-0 text-muted-foreground" />
          <Avatar className="size-4 shrink-0 text-[7px]">
            <AvatarFallback>DA</AvatarFallback>
          </Avatar>
        </div>
      ) : null}

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

/** The Nexxus lockup, in the two forms the real OperatorRail uses.
 *
 *  `full` is the whole thing, icon + wordmark. That is what an EXPANDED rail
 *  shows.
 *  `icon` is the mark alone, which is what a COLLAPSED rail shows. It is made by
 *  clipping the wordmark off the same lockup with a fixed-width overflow wrapper,
 *  the mechanism OperatorRail itself uses. NOT clip-path, which does not affect
 *  layout and would let the image blow out its container. `logo-black.svg` is
 *  viewBox 0 0 567.04 125.65, so it renders ~4.5x as wide as it is tall; the icon
 *  is the leftmost ~26% and the wordmark starts at ~34%, so a window at ~28% of
 *  the full width shows the icon and nothing else.
 *
 *  Pick by the rail's state, not by taste: an expanded rail showing only the icon
 *  is wearing the collapsed rail's clothes.
 */
export function RailLogo({
  variant = 'icon',
  className,
  iconWidth,
}: {
  variant?: 'icon' | 'full'
  className?: string
  /** Width of the clip window. Required for `icon`, ignored for `full`. */
  iconWidth?: string
}) {
  const img = (
    <Image src="/brand/logo-black.svg" alt="Nexxus" width={567} height={126} className="h-full w-auto max-w-none" />
  )
  if (variant === 'full') return <span className={cn('block w-auto', className)}>{img}</span>
  return <span className={cn('block overflow-hidden', iconWidth, className)}>{img}</span>
}

const RAIL_TABS: LucideIcon[] = [Home, CalendarDays, Users, CreditCard]

/** Slim rail echoing the real OperatorRail.
 *  'sketch' is the original abstract treatment, kept for CapabilityExplorer
 *  until its rail-vs-tab-bar question is settled (see the spec's follow-up).
 *  'app' mirrors OperatorRail: the real Nexxus mark, real nav icons, and the
 *  active tab filled brand-600, matching `active && "bg-brand-600 text-white"`.
 */
export function MiniRail({ variant = 'sketch' }: { variant?: 'sketch' | 'app' }) {
  if (variant === 'sketch') {
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

  return (
    <div className="hidden w-11 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-card py-3 sm:flex" aria-hidden>
      {/* collapsed rail, so: icon only */}
      <RailLogo className="mb-2 h-4" iconWidth="w-5" />
      {RAIL_TABS.map((Icon, i) => (
        <span
          key={i}
          className={cn('grid size-6 place-items-center rounded-chip', i === 0 && 'bg-brand-600')}
        >
          <Icon className={cn('size-3.5', i === 0 ? 'text-white' : 'text-muted-foreground')} />
        </span>
      ))}
      <span className="mt-auto grid size-6 place-items-center rounded-chip">
        <Settings className="size-3.5 text-muted-foreground" />
      </span>
    </div>
  )
}
