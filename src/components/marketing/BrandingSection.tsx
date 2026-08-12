'use client'

import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { CalendarDays, Camera, CreditCard, Home, MessageSquare, Settings, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { deriveBrandRamp, rampToCssVars } from '@/lib/branding/palette'
import { orgInitials } from '@/lib/branding/monogram'
import { cn } from '@/lib/utils'
import { BrowserFrame, PhoneFrame } from './frames'

interface BrandPreset {
  name: string
  hex: string
  Logo: React.ComponentType<{ className?: string }>
}

// "Uploaded" logo marks for the preset companies. Like the PRESETS hexes, the
// fills are DATA: a real tenant's logo arrives as a fixed-color asset and does
// not tint with the theme. Summit Shine's green mark on an amber brand is
// deliberate; matching is the norm, not the rule. When the visitor types their
// own name, these give way to the monogram (no logo uploaded yet).
function SparkleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 1.5 14.6 9.4 22.5 12 14.6 14.6 12 22.5 9.4 14.6 1.5 12 9.4 9.4 Z" fill="#DB2777" />
    </svg>
  )
}

function PeakMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="18.5" cy="5.5" r="2.5" fill="#D97706" />
      <path d="M1.5 20.5h21L14 8l-3.4 5.6L8.2 10 1.5 20.5Z" fill="#D97706" />
    </svg>
  )
}

function BirdMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g fill="#8B5CF6">
        <path d="M1.8 6.8 10 12.6 7 16.4 Z" />
        <ellipse cx="12.8" cy="14.6" rx="5.8" ry="4.4" />
        <circle cx="17" cy="8.6" r="3.3" />
        <path d="M20 7.3 23.2 8.7 20.1 9.9 Z" />
      </g>
      <circle cx="18.1" cy="7.9" r="0.75" fill="#FFFFFF" />
    </svg>
  )
}

// Demo identities. These hexes are DATA, not styling: they feed the production
// deriveBrandRamp pipeline exactly like a tenant's saved brand color does.
const PRESETS: BrandPreset[] = [
  { name: 'Sparkle & Co', hex: '#DB2777', Logo: SparkleMark },
  { name: 'Summit Shine', hex: '#FFAA00', Logo: PeakMark },
  { name: 'Swift Home', hex: '#8B5CF6', Logo: BirdMark },
]

const RAIL_ITEMS = [
  { label: 'Overview', Icon: Home },
  { label: 'Calendar', Icon: CalendarDays },
  { label: 'Crew', Icon: Users },
  { label: 'Payments', Icon: CreditCard },
  { label: 'Messages', Icon: MessageSquare },
]

/** Expanded operator rail at sketch scale: lockup with the live company name
 * (uploaded logo when the preset has one, monogram otherwise), labeled nav
 * (first item active in brand), settings pinned to the bottom. */
function ExpandedDemoRail({ name, logo }: { name: string; logo?: React.ReactNode }) {
  const display = name.trim() || 'Your Company'
  return (
    <div className="flex w-24 shrink-0 flex-col gap-1 border-r border-border bg-card p-2 sm:w-32" aria-hidden>
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        {logo ?? (
          <span className="grid size-5 shrink-0 place-items-center rounded-chip bg-primary text-[8px] font-extrabold text-primary-foreground transition-colors duration-slow">
            {orgInitials(display)}
          </span>
        )}
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

// The universal color-wheel affordance for the picker swatch: it means "any
// color you want", not a palette choice, and is replaced by the real hex the
// moment the visitor picks one. Stops are the Tailwind 500 hues.
const COLOR_WHEEL =
  'conic-gradient(from 0deg, #ef4444, #f59e0b, #84cc16, #06b6d4, #3b82f6, #a855f7, #ef4444)'

export function BrandingSection() {
  const [brand, setBrand] = React.useState<BrandPreset>(PRESETS[0])
  const [pickedColor, setPickedColor] = React.useState(false)
  // The visitor's own company name. Kept separate from the preset identities:
  // the input stays empty (an invitation to type) while the presets cycle, and
  // once typed it wins over every preset name.
  const [customName, setCustomName] = React.useState('')
  const sectionRef = React.useRef<HTMLElement>(null)
  const [interacted, setInteracted] = React.useState(false)
  const [inView, setInView] = React.useState(false)
  const reduced = useReducedMotion() ?? false

  // Cycle only while the section is actually on screen.
  React.useEffect(() => {
    const node = sectionRef.current
    if (!node) return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 })
    io.observe(node)
    return () => io.disconnect()
  }, [])

  // Idle brand cycle: stops permanently on first interaction, never runs under
  // reduced motion, pauses offscreen.
  React.useEffect(() => {
    if (interacted || reduced || !inView) return
    const timer = setInterval(() => {
      setBrand((prev) => {
        const i = PRESETS.findIndex((p) => p.name === prev.name && p.hex === prev.hex)
        return PRESETS[(i + 1) % PRESETS.length] ?? PRESETS[0]
      })
    }, 4000)
    return () => clearInterval(timer)
  }, [interacted, reduced, inView])

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

  const display = customName.trim() || brand.name
  const domain = display.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'yourcompany'

  return (
    <section id="white-label" ref={sectionRef} className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary">White-label</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Your customers see your brand. Not ours.
          </h2>
          <p className="mt-3 text-base font-medium text-muted-foreground">
            Pick a color, type your name, and upload your logo. The whole platform wears it, and
            your customers see your brand in every email, receipt, and booking page. Included on
            every plan.
          </p>
        </div>

        {/* Tableau: everything inside this wrapper repaints from the brand vars. */}
        <div style={brandVars} className="relative mx-auto mt-10 max-w-2xl" aria-hidden>
          <BrowserFrame
            label={`app.${domain}.com`}
            rail={
              <ExpandedDemoRail
                name={display}
                logo={customName.trim() ? undefined : <brand.Logo className="size-5 shrink-0" />}
              />
            }
            className="mr-12 sm:mr-24"
          >
            {/* pr clears the overlapping phone so pills never clip mid-word.
                Mobile drops the third KPI and lets the demo lines flex so the
                sliver between rail and phone never crushes its content. */}
            <div className="space-y-2 p-3 pr-20 sm:pr-24">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: 'Today', value: '6' },
                  { label: 'Active', value: '2' },
                  { label: 'This month', value: '$12.4k', desktopOnly: true },
                ].map((k) => (
                  <div
                    key={k.label}
                    className={cn('rounded-control border border-border bg-card p-2', k.desktopOnly && 'hidden sm:block')}
                  >
                    <p className="text-[8px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{k.label}</p>
                    <p className="text-sm font-extrabold text-foreground tnum">{k.value}</p>
                  </div>
                ))}
              </div>
              {[
                { max: 'max-w-24', pill: 'Scheduled', brand: true },
                { max: 'max-w-32', pill: 'Done', brand: false },
                { max: 'max-w-28', pill: 'In progress', brand: true },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-control border border-border bg-card px-2.5 py-2">
                  <DemoLine className={cn('min-w-3 flex-1', row.max)} />
                  <span
                    className={cn(
                      'shrink-0 rounded-pill px-2 py-0.5 text-[8px] font-bold transition-colors duration-slow',
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
            className="absolute -bottom-6 right-0 z-10 w-32 sm:w-40"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                {customName.trim() ? (
                  <span className="grid size-5 shrink-0 place-items-center rounded-chip bg-primary text-[8px] font-extrabold text-primary-foreground transition-colors duration-slow">
                    {orgInitials(display)}
                  </span>
                ) : (
                  <brand.Logo className="size-5 shrink-0" />
                )}
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
        <div
          onPointerDownCapture={() => setInteracted(true)}
          onFocusCapture={() => setInteracted(true)}
          className="mx-auto mt-12 flex w-fit max-w-full flex-wrap items-center justify-center gap-2.5 rounded-card border border-border bg-card px-4 py-3 shadow-soft-md sm:rounded-pill"
        >
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
              </button>
            )
          })}
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-pill border border-border px-3.5">
            <span className="text-sm font-semibold text-muted-foreground">Your brand color</span>
            <span
              className="relative size-6 shrink-0 overflow-hidden rounded-pill border border-border"
              style={pickedColor ? { backgroundColor: brand.hex } : { background: COLOR_WHEEL }}
            >
              <input
                type="color"
                value={brand.hex}
                onChange={(e) => {
                  setPickedColor(true)
                  setBrand((b) => ({ ...b, hex: e.target.value }))
                }}
                aria-label="Pick your brand color"
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </span>
          </label>
          <label className="flex min-h-11 items-center rounded-pill border border-border px-3.5">
            <input
              type="text"
              value={customName}
              maxLength={24}
              placeholder="Your company name here"
              aria-label="Your company name"
              onChange={(e) => setCustomName(e.target.value)}
              className="w-48 border-0 bg-transparent p-0 text-sm font-semibold text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
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
