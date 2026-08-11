'use client'

import * as React from 'react'
import { CalendarDays, Camera, Check, CreditCard, Home, MessageSquare, Settings, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { deriveBrandRamp, rampToCssVars } from '@/lib/branding/palette'
import { orgInitials } from '@/lib/branding/monogram'
import { cn } from '@/lib/utils'
import { BrowserFrame, PhoneFrame } from './frames'

interface BrandPreset {
  name: string
  hex: string
}

// Demo identities. These hexes are DATA, not styling: they feed the production
// deriveBrandRamp pipeline exactly like a tenant's saved brand color does.
const PRESETS: BrandPreset[] = [
  { name: 'Sparkle & Co', hex: '#0FA47A' },
  { name: 'Summit Shine', hex: '#E86A2C' },
  { name: 'Bluebird Home', hex: '#7C5CFF' },
]

const RAIL_ITEMS = [
  { label: 'Overview', Icon: Home },
  { label: 'Calendar', Icon: CalendarDays },
  { label: 'Crew', Icon: Users },
  { label: 'Payments', Icon: CreditCard },
  { label: 'Messages', Icon: MessageSquare },
]

/** Expanded operator rail at sketch scale: lockup with the live company name,
 * labeled nav (first item active in brand), settings pinned to the bottom. */
function ExpandedDemoRail({ name }: { name: string }) {
  const display = name.trim() || 'Your Company'
  return (
    <div className="flex w-32 shrink-0 flex-col gap-1 border-r border-border bg-card p-2" aria-hidden>
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <span className="grid size-5 shrink-0 place-items-center rounded-chip bg-primary text-[8px] font-extrabold text-primary-foreground transition-colors duration-slow">
          {orgInitials(display)}
        </span>
        <span className="truncate text-[10px] font-bold text-foreground">{display}</span>
      </div>
      {RAIL_ITEMS.map(({ label, Icon }, i) => (
        <span
          key={label}
          className={cn(
            'flex items-center gap-1.5 rounded-chip px-1.5 py-1 text-[9px] font-semibold transition-colors duration-slow',
            i === 0 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-3 shrink-0" />
          {label}
        </span>
      ))}
      <span className="mt-auto flex items-center gap-1.5 px-1.5 py-1 text-[9px] font-semibold text-muted-foreground">
        <Settings className="size-3 shrink-0" />
        Settings
      </span>
    </div>
  )
}

function DemoLine({ className }: { className?: string }) {
  return <span className={cn('block h-1.5 rounded-pill bg-muted', className)} />
}

export function BrandingSection() {
  const [brand, setBrand] = React.useState<BrandPreset>(PRESETS[0])

  // The production theming engine, scoped to the tableau below. The semantic
  // aliases (--primary, --accent, ...) are re-declared here because :root
  // resolves them against ITS --brand-* once; re-chaining on this wrapper makes
  // them re-resolve against the overridden ramp.
  const brandVars = React.useMemo(
    () =>
      ({
        ...rampToCssVars(deriveBrandRamp(brand.hex)),
        '--primary': 'var(--brand-600)',
        '--primary-foreground': 'var(--brand-fg-600)',
        '--accent': 'var(--brand-50)',
        '--accent-foreground': 'var(--brand-700)',
        '--ring': 'var(--brand-600)',
        '--brand-ink': 'var(--brand-ink-on-light)',
      }) as React.CSSProperties,
    [brand.hex],
  )

  const display = brand.name.trim() || 'Your Company'
  const domain = display.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'yourcompany'

  return (
    <section id="white-label" className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary">White-label</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Your customers see your brand. Not ours.
          </h2>
          <p className="mt-3 text-base font-medium text-muted-foreground">
            Pick a color, type your name, and the whole platform wears it. Included on every plan.
          </p>
        </div>

        {/* Tableau: everything inside this wrapper repaints from the brand vars. */}
        <div style={brandVars} className="relative mx-auto mt-10 max-w-2xl" aria-hidden>
          <BrowserFrame label={`app.${domain}.com`} rail={<ExpandedDemoRail name={brand.name} />} className="mr-14 sm:mr-24">
            {/* pr clears the overlapping phone so pills never clip mid-word */}
            <div className="space-y-2 p-3 pr-16 sm:pr-24">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Today', value: '6' },
                  { label: 'In progress', value: '2' },
                  { label: 'This month', value: '$12.4k' },
                ].map((k) => (
                  <div key={k.label} className="rounded-control border border-border bg-card p-2">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{k.label}</p>
                    <p className="text-sm font-extrabold text-foreground tnum">{k.value}</p>
                  </div>
                ))}
              </div>
              {[
                { w: 'w-24', pill: 'Scheduled', brand: true },
                { w: 'w-32', pill: 'Done', brand: false },
                { w: 'w-28', pill: 'In progress', brand: true },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2">
                  <DemoLine className={row.w} />
                  <span
                    className={cn(
                      'rounded-pill px-2 py-0.5 text-[8px] font-bold transition-colors duration-slow',
                      row.brand ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {row.pill}
                  </span>
                </div>
              ))}
            </div>
          </BrowserFrame>

          <PhoneFrame
            initials={orgInitials(display)}
            tabs={[Home, CalendarDays, Camera, CreditCard]}
            className="absolute -bottom-6 right-0 z-10 w-36 sm:w-40"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-chip bg-primary text-[8px] font-extrabold text-primary-foreground transition-colors duration-slow">
                  {orgInitials(display)}
                </span>
                <span className="truncate text-[10px] font-bold text-foreground">{display}</span>
              </div>
              <div className="rounded-control border border-border bg-card p-2">
                <p className="text-[9px] font-bold text-foreground">2:00 PM &middot; Deep clean</p>
                <DemoLine className="mt-1.5 w-4/5" />
                <DemoLine className="mt-1 w-3/5" />
              </div>
              <span className="block rounded-pill bg-primary py-1.5 text-center text-[10px] font-bold text-primary-foreground transition-colors duration-slow">
                Start job
              </span>
            </div>
          </PhoneFrame>
        </div>

        {/* Theme bar: the visitor's controls. Deliberately OUTSIDE the brand-vars
            wrapper so the controls themselves stay in Nexxus chrome. */}
        <div className="mx-auto mt-12 flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-card border border-border bg-card px-3 py-2 shadow-soft-md sm:rounded-pill">
          {PRESETS.map((p) => {
            const active = brand.name === p.name && brand.hex === p.hex
            return (
              <button
                key={p.name}
                type="button"
                aria-pressed={active}
                onClick={() => setBrand(p)}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-pill border px-3 text-sm font-semibold transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-transparent bg-accent text-accent-foreground ring-2 ring-ring'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="size-3 rounded-pill" style={{ backgroundColor: p.hex }} />
                {p.name}
                {active ? <Check className="size-4" aria-hidden /> : null}
              </button>
            )
          })}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-border px-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Brand color</span>
            <span className="relative size-6 overflow-hidden rounded-pill border border-border" style={{ backgroundColor: brand.hex }}>
              <input
                type="color"
                value={brand.hex}
                onChange={(e) => setBrand((b) => ({ ...b, hex: e.target.value }))}
                aria-label="Pick your brand color"
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded-pill border border-border px-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Company name</span>
            <input
              type="text"
              value={brand.name}
              maxLength={24}
              onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
              className="w-32 border-0 bg-transparent p-0 text-sm font-semibold text-foreground focus:outline-none focus:ring-0"
            />
          </label>
        </div>

        <p className="mt-6 text-center text-sm font-medium text-muted-foreground">
          Some platforms charge $197 a month to take their logo off. Here it is included.
        </p>
      </div>
    </section>
  )
}
