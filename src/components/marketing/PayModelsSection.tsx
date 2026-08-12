'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { Clock, SlidersHorizontal, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Reveal } from './Reveal'

const EASE = [0.22, 1, 0.36, 1] as const

// Mirrors the real PayoutModel space: 'flexible' is the contractor umbrella
// (percentage | flat | cleaner-requested price, chosen PER CLEANER), 'hourly'
// is hourly_external (paid through the org's own payroll).
const MODELS = [
  {
    id: 'flexible',
    icon: SlidersHorizontal,
    name: 'Flexible payouts',
    tagline:
      'The contractor model. Each cleaner can be on a percentage of the job, a flat rate per job, or name their own price. Set a default, override per person.',
  },
  {
    id: 'hourly',
    icon: Clock,
    name: 'Hourly with set availability',
    tagline:
      'Pay employees by the hour and let each cleaner set the days and times they are available to work.',
  },
] as const

type ModelId = (typeof MODELS)[number]['id']

// The flexible vignette is a crew roster: one crew, all three arrangements
// live at once, exactly how per-cleaner pay works in the product.
const CREW = [
  { name: 'Maria', mode: 'Percentage of each job', value: '80%', line: 'Keeps $144 of a $180 job' },
  { name: 'Dana', mode: 'Flat rate per job', value: '$95', line: 'Same pay on every visit' },
  { name: 'Alex', mode: 'Sets their own rate', value: 'Job by job', line: 'Names a price, you approve it' },
]

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 px-1">
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  )
}

function SelectedRow({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between rounded-control border border-border bg-card px-3.5 py-3">
      <span className="text-sm font-semibold text-foreground">{name}</span>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
        <CheckCircle2 className="size-4" aria-hidden />
        Selected
      </span>
    </div>
  )
}

function FlexibleVignette() {
  return (
    <>
      <SelectedRow name="Flexible payouts" />
      <SectionDivider label="Your crew" />
      {CREW.map((c) => (
        <div key={c.name} className="flex items-center justify-between gap-3 rounded-control border border-border bg-card px-3.5 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{c.name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{c.mode}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block rounded-pill bg-accent px-3 py-1 text-sm font-bold text-accent-foreground tnum">{c.value}</span>
            <span className="mt-1 block text-[10px] font-medium text-muted-foreground">{c.line}</span>
          </span>
        </div>
      ))}
      <p className="text-xs font-medium text-muted-foreground">
        Mix all three on one crew. Everyone is paid to their bank after the job, automatically.
      </p>
    </>
  )
}

function HourlyVignette() {
  return (
    <>
      <SelectedRow name="Hourly with set availability" />
      <div className="flex items-center justify-between rounded-control border border-border bg-card px-3.5 py-3">
        <span className="text-sm text-muted-foreground">Rate for this cleaner</span>
        <span className="rounded-pill bg-accent px-3 py-1 text-sm font-bold text-accent-foreground tnum">$28 / hr</span>
      </div>
      <SectionDivider label="Cleaner sees" />
      <div className="rounded-control bg-gradient-to-br from-brand-600 to-brand-500 px-4 py-3.5 text-white shadow-soft-md">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/80">Earned on a 2 hour job</p>
        <p className="mt-0.5 text-3xl font-extrabold tnum">$56</p>
        <p className="mt-1 text-[11px] text-white/85">
          Paid out through your own payroll, not per job. Nexxus pays your company and you pay your
          team on your normal schedule.
        </p>
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        Availability feeds the schedule, so you only assign who is free.
      </p>
    </>
  )
}

export function PayModelsSection() {
  const reduced = useReducedMotion() ?? false
  const [active, setActive] = React.useState<ModelId>('flexible')

  return (
    <section className="border-y border-border bg-card">
      <Reveal className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary">However you pay your crew</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Two pay models, one platform
          </h2>
          <p className="mt-3 text-base font-medium text-muted-foreground">
            Most tools force one payroll style on you. Nexxus adapts to how your business actually
            works. Pick a model and the whole app follows.
          </p>
        </div>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* selector */}
          <div className="grid gap-3">
            {MODELS.map((mdl) => {
              const selected = mdl.id === active
              return (
                <button
                  key={mdl.id}
                  type="button"
                  onClick={() => setActive(mdl.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex items-start gap-3 rounded-card border bg-card p-4 text-left transition-all duration-base ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected ? 'border-primary shadow-soft-md ring-1 ring-brand-200' : 'border-border hover:bg-muted',
                  )}
                >
                  <span className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-control transition-colors',
                    selected ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground',
                  )}>
                    <mdl.icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-foreground">{mdl.name}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{mdl.tagline}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* vignette: what the payout settings produce for each model */}
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border bg-background px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Payout settings</p>
            </div>
            <div className="p-5">
              <AnimatePresence mode="wait">
                <m.div
                  key={active}
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="grid gap-3"
                >
                  {active === 'flexible' ? <FlexibleVignette /> : <HourlyVignette />}
                </m.div>
              </AnimatePresence>
            </div>
          </Card>
        </div>
      </Reveal>
    </section>
  )
}
