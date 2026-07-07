'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { CalendarDays, ChevronDown, Wallet } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { BrowserFrame, MiniRail } from './frames'
import { AUTO_BOOKING, DEMO_CLEANERS, DEMO_JOBS, cleanerById, type DemoJob } from './demo-data'

const EASE = [0.16, 1, 0.3, 1] as const

function JobRow({
  job,
  expanded,
  onToggle,
  onAssign,
}: {
  job: DemoJob
  expanded: boolean
  onToggle: () => void
  onAssign: (cleanerId: string) => void
}) {
  const cleaner = cleanerById(job.cleanerId)
  const needsAssign = job.status === 'pending'
  return (
    <div className="rounded-control border border-border bg-card transition-colors duration-base">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 rounded-control px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-8 shrink-0 text-[10px]">
            <AvatarFallback>{cleaner?.initials ?? '?'}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">
              {job.customer} · {job.address}
            </span>
            <span className="block text-xs text-muted-foreground">
              {job.time} · {job.service}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {needsAssign ? (
            <StatusPill status="pending" label="Needs you" className="px-2.5 py-0.5 text-[11px]" />
          ) : (
            <StatusPill status={job.status} className="px-2.5 py-0.5 text-[11px]" />
          )}
          <ChevronDown
            className={cn('size-4 text-muted-foreground transition-transform duration-base', expanded && 'rotate-180')}
            aria-hidden
          />
        </span>
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-base ease-out-soft',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border px-3.5 py-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {job.service} · <span className="font-bold text-foreground tnum">${job.price}</span>
                {cleaner ? <span> · {cleaner.name}</span> : null}
              </span>
              {needsAssign ? (
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">Send it to:</span>
                  {DEMO_CLEANERS.map((c) => (
                    <Button key={c.id} size="sm" variant="outline" className="h-8 px-3" onClick={() => onAssign(c.id)}>
                      {c.name}
                    </Button>
                  ))}
                </span>
              ) : (
                <span>Customer gets updates automatically</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TodayTab({
  jobs,
  onAssign,
  justAssigned,
}: {
  jobs: DemoJob[]
  onAssign: (jobId: string, cleanerId: string) => void
  justAssigned: string | null
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const needsYou = jobs.filter((j) => j.status === 'pending').length
  const inProgress = jobs.filter((j) => j.status === 'in_progress').length
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Jobs today', value: <AnimatedNumber value={jobs.length} /> },
          { label: 'In progress', value: <AnimatedNumber value={inProgress} /> },
          { label: 'Needs you', value: <AnimatedNumber value={needsYou} /> },
          { label: 'Revenue today', value: <AnimatedNumber value={1240} prefix="$" /> },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-control border border-border bg-card p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{kpi.label}</p>
            <p className="mt-0.5 text-xl font-extrabold text-foreground tnum">{kpi.value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2">
        <AnimatePresence initial={false}>
          {jobs.map((job) => (
            <m.div
              key={job.id}
              layout
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <JobRow
                job={job}
                expanded={expanded === job.id}
                onToggle={() => setExpanded((e) => (e === job.id ? null : job.id))}
                onAssign={(cleanerId) => onAssign(job.id, cleanerId)}
              />
            </m.div>
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {justAssigned ? (
            <m.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs font-semibold text-positive-700"
              role="status"
            >
              {justAssigned} just got a text with the job details.
            </m.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

function CalendarTab({ jobs }: { jobs: DemoJob[] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const placed: Record<string, DemoJob[]> = {
    Mon: [],
    Tue: [jobs[0], jobs[1]].filter(Boolean),
    Wed: [],
    Thu: jobs.filter((j) => j.time.startsWith('Thu')),
    Fri: jobs.filter((j) => j.time.startsWith('Fri')),
  }
  return (
    <div className="grid grid-cols-5 gap-2">
      {days.map((day) => (
        <div key={day} className="min-h-36 rounded-control border border-border bg-card p-2">
          <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {day}
          </p>
          <div className="grid gap-1.5">
            {placed[day].map((job) => (
              <div key={job.id} className="rounded-chip bg-accent px-2 py-1.5 text-[10px] font-semibold text-accent-foreground">
                <span className="block truncate">{job.customer}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PaymentsTab() {
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="rounded-control border border-border bg-card p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Collected this week</p>
        <p className="mt-0.5 text-2xl font-extrabold text-foreground tnum">
          <AnimatedNumber value={3860} prefix="$" />
        </p>
      </div>
      {[
        { who: 'Chen family · Standard clean', amount: '$140', state: 'Paid', variant: 'positive' as const },
        { who: 'Harbor View rental · Move-out', amount: '$220', state: 'Charges at completion', variant: 'secondary' as const },
        { who: 'Maria R. · payout', amount: '$96', state: 'On its way', variant: 'default' as const },
      ].map((row) => (
        <div key={row.who} className="flex items-center justify-between rounded-control border border-border bg-card px-3.5 py-3 text-sm">
          <span className="min-w-0 truncate font-semibold text-foreground">{row.who}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-bold text-foreground tnum">{row.amount}</span>
            <Badge variant={row.variant} className="px-2.5 py-0.5">{row.state}</Badge>
          </span>
        </div>
      ))}
    </div>
  )
}

export function LiveDemoSection() {
  const reduced = useReducedMotion()
  const [jobs, setJobs] = React.useState<DemoJob[]>(DEMO_JOBS)
  const [justAssigned, setJustAssigned] = React.useState<string | null>(null)
  const interactedRef = React.useRef(false)
  const sectionRef = React.useRef<HTMLElement>(null)

  // One scripted beat: a new booking slides in a few seconds after the demo is
  // seen, then the stage is the visitor's. Never repeats, never fights input.
  React.useEffect(() => {
    if (reduced) return
    const node = sectionRef.current
    if (!node) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let played = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !played) {
          played = true
          timer = setTimeout(() => {
            if (!interactedRef.current) {
              setJobs((current) => (current.some((j) => j.id === AUTO_BOOKING.id) ? current : [...current, AUTO_BOOKING]))
            }
          }, 6000)
        }
      },
      { threshold: 0.35 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [reduced])

  const handleAssign = (jobId: string, cleanerId: string) => {
    interactedRef.current = true
    setJobs((current) =>
      current.map((j) => (j.id === jobId ? { ...j, cleanerId, status: 'scheduled' as const } : j)),
    )
    const cleaner = cleanerById(cleanerId)
    if (cleaner) {
      setJustAssigned(cleaner.name)
      setTimeout(() => setJustAssigned(null), 4000)
    }
  }

  return (
    <section id="try-it" ref={sectionRef} className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="secondary">Try it</Badge>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          Now run the office yourself
        </h2>
        <p className="mt-3 text-base font-medium text-muted-foreground">
          This is the operator view with a demo company loaded. Open a job, assign a cleaner,
          poke around. Nothing here can break.
        </p>
      </div>
      <div className="mt-10" onPointerDown={() => (interactedRef.current = true)}>
        <BrowserFrame label="app.nexxus · Brightside Cleaning Co · demo data">
          <div className="flex">
            <MiniRail />
            <div className="min-w-0 flex-1 bg-background p-4 sm:p-5">
              <Tabs defaultValue="today">
                <TabsList>
                  <TabsTrigger value="today">Today</TabsTrigger>
                  <TabsTrigger value="calendar" className="gap-1.5">
                    <CalendarDays className="size-4" aria-hidden />
                    Calendar
                  </TabsTrigger>
                  <TabsTrigger value="payments" className="gap-1.5">
                    <Wallet className="size-4" aria-hidden />
                    Payments
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="today" className="mt-4">
                  <TodayTab jobs={jobs} onAssign={handleAssign} justAssigned={justAssigned} />
                </TabsContent>
                <TabsContent value="calendar" className="mt-4">
                  <CalendarTab jobs={jobs} />
                </TabsContent>
                <TabsContent value="payments" className="mt-4">
                  <PaymentsTab />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </BrowserFrame>
      </div>
    </section>
  )
}
