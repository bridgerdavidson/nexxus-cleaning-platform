import * as React from 'react'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import { Bell, CalendarDays, CreditCard, Home, Plus, Search, Settings, Users, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

/** Browser-chrome wrapper for desktop app vignettes.
 *  `appBar` adds the operator top bar (search / New booking / bell / avatar),
 *  mirroring OperatorTopBar at sketch scale.
 *  `rail` slots the app's rail in beside the content.
 *  Both are off by default: CapabilityExplorer's original layout wanted browser
 *  chrome only.
 *
 *  Layout, when a rail is given, follows the real shell rather than the obvious
 *  reading: OperatorRail is `fixed inset-y-0 left-0`, so it owns the full height
 *  and the top bar is offset to its right ("Sits to the right of the rail on
 *  desktop (parent offsets it)"). The rail is dominant; the bar starts where the
 *  rail ends. Only the browser chrome spans everything, because that belongs to
 *  the browser, not the app.
 */
export function BrowserFrame({
  label,
  appBar = false,
  rail,
  className,
  children,
}: {
  label: string
  appBar?: boolean
  rail?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const bar = appBar ? (
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
  ) : null

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

      {rail ? (
        <div className="flex">
          {rail}
          <div className="min-w-0 flex-1">
            {bar}
            {children}
          </div>
        </div>
      ) : (
        <>
          {bar}
          {children}
        </>
      )}
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
            <Icon className={cn('size-3.5', i === 0 ? 'text-brand-ink' : 'text-muted-foreground')} />
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

/** Slim collapsed rail, mirroring the real OperatorRail: the Nexxus mark, real
 *  nav icons, and the active tab filled brand-600, matching OperatorRail's own
 *  `active && "bg-brand-600 text-white"`.
 *
 *  Decorative. CapabilityExplorer's rail is real navigation and lives there.
 *
 *  Unconditionally `flex`, never `sm:flex`: this rail lives inside FlowShowcase's
 *  fixed 1060px stage, which is uniformly transform-scaled, not reflowed. The
 *  internal layout always computes at 1060px regardless of the real viewport, and
 *  the flight paths are measured against that layout WITH the rail present. A
 *  viewport breakpoint here would drop the rail below 640px, widen the operator
 *  column by 44px, shift #flow-queue-row, and leave the flying card landing off
 *  target. Keep it always-on.
 */
export function MiniRail() {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-card py-3" aria-hidden>
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
