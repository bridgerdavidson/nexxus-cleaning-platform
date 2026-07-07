'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { Percent, Clock, HandCoins, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const

interface Model {
  id: string
  icon: React.ComponentType<{ className?: string }>
  name: string
  tagline: string
  // the settings vignette
  setting: string
  settingValue: string
  // the resulting cleaner earnings line for a $180 job
  cleanerLine: string
  cleanerAmount: string
  note: string
}

const MODELS: Model[] = [
  {
    id: 'contractor',
    icon: Percent,
    name: 'Percentage or flat rate',
    tagline: 'The contractor model. Pay a set cut of each job or a fixed amount per job. Set one default, override per person.',
    setting: 'Default cleaner payout',
    settingValue: '80%',
    cleanerLine: 'Your cut of a $180 job',
    cleanerAmount: '$144',
    note: 'Overrides let your best cleaners earn more.',
  },
  {
    id: 'hourly',
    icon: Clock,
    name: 'Hourly with set availability',
    tagline: 'Pay employees by the hour and let each cleaner set the days and times they are available to work.',
    setting: 'Rate for this cleaner',
    settingValue: '$28 / hr',
    cleanerLine: 'Earned on a 2 hour job',
    cleanerAmount: '$56',
    note: 'Availability feeds the schedule, so you only assign who is free.',
  },
  {
    id: 'cleaner-set',
    icon: HandCoins,
    name: 'Cleaner sets their rate',
    tagline: 'Let independent cleaners name their price per job and accept the work that fits.',
    setting: 'Maria’s rate for this job',
    settingValue: '$95',
    cleanerLine: 'Maria keeps',
    cleanerAmount: '$95',
    note: 'For marketplaces and independent contractor networks.',
  },
]

export function PayModelsSection() {
  const reduced = useReducedMotion() ?? false
  const [active, setActive] = React.useState(0)
  const model = MODELS[active]

  return (
    <section className="border-y border-border bg-card">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary">However you pay your crew</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Three ways to pay, one platform
          </h2>
          <p className="mt-3 text-base font-medium text-muted-foreground">
            Most tools force one payroll style on you. Nexxus adapts to how your business actually
            works. Pick a model and the whole app follows.
          </p>
        </div>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* selector */}
          <div className="grid gap-3">
            {MODELS.map((mdl, i) => {
              const selected = i === active
              return (
                <button
                  key={mdl.id}
                  type="button"
                  onClick={() => setActive(i)}
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

          {/* vignette: settings toggle -> cleaner earnings */}
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border bg-background px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Payout settings</p>
            </div>
            <div className="p-5">
              <AnimatePresence mode="wait">
                <m.div
                  key={model.id}
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="grid gap-3"
                >
                  <div className="flex items-center justify-between rounded-control border border-border bg-card px-3.5 py-3">
                    <span className="text-sm font-semibold text-foreground">{model.name}</span>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                      <CheckCircle2 className="size-4" aria-hidden />
                      Selected
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-control border border-border bg-card px-3.5 py-3">
                    <span className="text-sm text-muted-foreground">{model.setting}</span>
                    <span className="rounded-pill bg-accent px-3 py-1 text-sm font-bold text-accent-foreground tnum">
                      {model.settingValue}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2 px-1">
                    <span className="h-px flex-1 bg-border" aria-hidden />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Cleaner sees</span>
                    <span className="h-px flex-1 bg-border" aria-hidden />
                  </div>

                  <div className="rounded-control bg-gradient-to-br from-brand-600 to-brand-500 px-4 py-3.5 text-white shadow-soft-md">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/80">{model.cleanerLine}</p>
                    <p className="mt-0.5 text-3xl font-extrabold tnum">{model.cleanerAmount}</p>
                    <p className="mt-1 text-[11px] text-white/85">Paid to their bank after the job, automatically.</p>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">{model.note}</p>
                </m.div>
              </AnimatePresence>
            </div>
          </Card>
        </div>
      </div>
    </section>
  )
}
