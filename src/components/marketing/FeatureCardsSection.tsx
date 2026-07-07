'use client'

import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { CalendarDays, CreditCard, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'

// Weekday index (0 = Monday) -> visit count, one believable month.
const MONTH: number[] = [
  0, 2, 1, 2, 1, 0, 0,
  0, 2, 2, 1, 2, 1, 0,
  0, 1, 2, 2, 1, 0, 0,
  0, 2, 1, 2, 2, 1, 0,
]

function MiniMonth() {
  const [selected, setSelected] = React.useState(9) // second Tuesday
  const visits = MONTH[selected]
  return (
    <div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Example month of visits">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={`${d}${i}`} className="text-center text-[10px] font-semibold text-muted-foreground" aria-hidden>
            {d}
          </span>
        ))}
        {MONTH.map((count, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelected(i)}
            aria-label={`Day ${i + 1}, ${count} visits`}
            className={cn(
              'grid aspect-square place-items-center rounded-chip text-[11px] font-semibold transition-colors duration-base',
              i === selected
                ? 'bg-primary text-primary-foreground'
                : count > 0
                  ? 'bg-accent text-accent-foreground hover:bg-brand-100'
                  : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs font-medium text-muted-foreground" aria-live="polite">
        {visits === 0
          ? 'A quiet day. Enjoy it.'
          : `${visits} recurring ${visits === 1 ? 'visit' : 'visits'}, booked and crewed on their own.`}
      </p>
    </div>
  )
}

function RevenueTicker() {
  const reduced = useReducedMotion()
  const [value, setValue] = React.useState(reduced ? 12480 : 11940)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (reduced) return
    const node = ref.current
    if (!node) return
    let ticks = 0
    let interval: ReturnType<typeof setInterval> | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !interval) {
          setValue(12480)
          interval = setInterval(() => {
            ticks += 1
            setValue((v) => v + [140, 180, 220][ticks % 3])
            if (ticks >= 6 && interval) clearInterval(interval)
          }, 2800)
        }
      },
      { threshold: 0.6 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (interval) clearInterval(interval)
    }
  }, [reduced])
  return (
    <div ref={ref}>
      <p className="text-2xl font-extrabold text-foreground tnum">
        <AnimatedNumber value={value} prefix="$" />
      </p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">
        collected this month, while you were on jobs
      </p>
    </div>
  )
}

const CYCLE = ['scheduled', 'in_progress', 'completed'] as const

function StatusCycler() {
  const reduced = useReducedMotion()
  const [index, setIndex] = React.useState(reduced ? 2 : 0)
  const [manual, setManual] = React.useState(false)
  React.useEffect(() => {
    if (reduced || manual) return
    const id = setInterval(() => setIndex((i) => (i + 1) % CYCLE.length), 2600)
    return () => clearInterval(id)
  }, [reduced, manual])
  return (
    <button
      type="button"
      onClick={() => {
        setManual(true)
        setIndex((i) => (i + 1) % CYCLE.length)
      }}
      className="flex w-full items-center justify-between rounded-control border border-border bg-card px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Cycle example job status"
    >
      <span className="text-xs font-semibold text-foreground">Sarah K. · Deep clean</span>
      <StatusPill status={CYCLE[index]} className="px-2.5 py-0.5 text-[11px]" />
    </button>
  )
}

const FEATURES = [
  {
    icon: CalendarDays,
    title: 'Scheduling that fills itself',
    body: 'Recurring visits rebook themselves and land on the right cleaner. Change something, and everyone is told automatically.',
    widget: <MiniMonth />,
  },
  {
    icon: CreditCard,
    title: 'Paid without chasing',
    body: 'Cards are saved at booking and charged when the job is completed. Payouts head to your cleaners on their own.',
    widget: <RevenueTicker />,
  },
  {
    icon: ListChecks,
    title: 'Know where every job stands',
    body: 'Scheduled, in progress, done, paid. One glance tells you, so nobody has to call and ask.',
    widget: <StatusCycler />,
  },
]

export function FeatureCardsSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="secondary">Everything in its place</Badge>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          The busywork, handled
        </h2>
        <p className="mt-3 text-base font-medium text-muted-foreground">
          These little widgets are live too. Go on, click them.
        </p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title} className="flex flex-col p-6">
            <span className="grid size-11 place-items-center rounded-control bg-accent text-accent-foreground">
              <feature.icon className="size-5" aria-hidden />
            </span>
            <h3 className="mt-4 text-lg font-bold text-foreground">{feature.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            <div className="mt-5 rounded-field border border-border bg-background p-4">{feature.widget}</div>
          </Card>
        ))}
      </div>
    </section>
  )
}
