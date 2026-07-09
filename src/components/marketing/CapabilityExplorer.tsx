'use client'

import * as React from 'react'
import { AnimatePresence, motion as m } from 'motion/react'
import {
  BarChart3,
  CreditCard,
  Home,
  MessageSquare,
  SprayCan,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { BrowserFrame, MiniRail } from './frames'
import { DEMO_CLEANERS, DEMO_JOBS, cleanerById, type DemoJob } from './demo-data'

const EASE = [0.22, 1, 0.36, 1] as const

const TABS = [
  { id: 'overview', label: 'Overview', Icon: Home },
  { id: 'analytics', label: 'Analytics', Icon: BarChart3 },
  { id: 'crew', label: 'Crew', Icon: SprayCan },
  { id: 'payments', label: 'Payments', Icon: CreditCard },
  { id: 'messages', label: 'Messages', Icon: MessageSquare },
] as const
type TabId = (typeof TABS)[number]['id']

// --- Overview: the hands-on assign demo (absorbed from the old Try-it) -------

function OverviewTab() {
  const [jobs, setJobs] = React.useState<DemoJob[]>(DEMO_JOBS)
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  const needsYou = jobs.filter((j) => j.status === 'pending').length

  const assign = (jobId: string, cleanerId: string) => {
    setJobs((cur) => cur.map((j) => (j.id === jobId ? { ...j, cleanerId, status: 'scheduled' } : j)))
    const c = cleanerById(cleanerId)
    if (c) {
      setToast(`${c.name} got a text with the job details.`)
      setTimeout(() => setToast(null), 3500)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Today's jobs", value: <AnimatedNumber value={6} /> },
          { label: 'In progress', value: <AnimatedNumber value={2} /> },
          { label: 'Needs you', value: <AnimatedNumber value={needsYou} /> },
          { label: 'Revenue this month', value: <AnimatedNumber value={12477} prefix="$" /> },
        ].map((k) => (
          <div key={k.label} className="rounded-control border border-border bg-card p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{k.label}</p>
            <p className="mt-0.5 text-xl font-extrabold text-foreground tnum">{k.value}</p>
          </div>
        ))}
      </div>
      <p className="px-1 text-[11px] font-bold text-foreground">Needs you now</p>
      <div className="grid grid-cols-1 gap-2">
        {jobs.map((job) => {
          const cleaner = cleanerById(job.cleanerId)
          const pending = job.status === 'pending'
          const open = expanded === job.id
          return (
            <div key={job.id} className="rounded-control border border-border bg-card">
              <button
                type="button"
                onClick={() => setExpanded((e) => (e === job.id ? null : job.id))}
                className="flex w-full items-center justify-between gap-3 rounded-control px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="size-8 shrink-0 text-[10px]"><AvatarFallback>{cleaner?.initials ?? '?'}</AvatarFallback></Avatar>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{job.customer} · {job.address}</span>
                    <span className="block text-xs text-muted-foreground">{job.time} · {job.service}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusPill status={pending ? 'pending' : job.status} label={pending ? 'Needs you' : undefined} className="px-2.5 py-0.5 text-[11px]" />
                  <ChevronDown className={cn('size-4 text-muted-foreground transition-transform duration-base', open && 'rotate-180')} aria-hidden />
                </span>
              </button>
              <div className={cn('grid transition-[grid-template-rows] duration-base ease-out-soft', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <div className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3.5 py-3 text-xs text-muted-foreground">
                    <span>{job.service} · <span className="font-bold text-foreground tnum">${job.price}</span>{cleaner ? ` · ${cleaner.name}` : ''}</span>
                    {pending ? (
                      <span className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">Assign:</span>
                        {DEMO_CLEANERS.map((c) => (
                          <Button key={c.id} size="sm" variant="outline" className="h-8 px-3" onClick={() => assign(job.id, c.id)}>{c.name}</Button>
                        ))}
                      </span>
                    ) : (
                      <span>Customer gets updates automatically</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        <AnimatePresence>
          {toast ? (
            <m.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="status" className="text-xs font-semibold text-positive-700">
              {toast}
            </m.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

// --- Analytics ---------------------------------------------------------------

const BARS = [8.2, 9.1, 7.4, 10.3, 11.8, 12.6, 12.0, 13.4]
const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

function AnalyticsTab() {
  const max = Math.max(...BARS)
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Revenue this month', value: '$12.6k', trend: '+18%' },
          { label: 'Jobs completed', value: '148', trend: '+9%' },
          { label: 'Avg per job', value: '$164', trend: '+4%' },
        ].map((s) => (
          <div key={s.label} className="rounded-control border border-border bg-card p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-lg font-extrabold text-foreground tnum">{s.value}</p>
            <p className="text-[10px] font-semibold text-positive-700">{s.trend}</p>
          </div>
        ))}
      </div>
      <div className="rounded-control border border-border bg-card p-4">
        <p className="mb-3 text-[11px] font-bold text-foreground">Revenue by month</p>
        <div className="flex h-32 items-end gap-2">
          {BARS.map((v, i) => (
            <div key={MONTHS[i]} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <m.div
                className={cn('w-full rounded-t-chip', i === BARS.length - 1 ? 'bg-brand-600' : 'bg-brand-200')}
                initial={{ height: 0 }}
                animate={{ height: `${(v / max) * 100}%` }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.06 }}
              />
              <span className="text-[9px] font-medium text-muted-foreground">{MONTHS[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-control border border-border bg-card p-3">
          <p className="text-[11px] font-bold text-foreground">Top cleaner</p>
          <div className="mt-2 flex items-center gap-2">
            <Avatar className="size-7 text-[9px]"><AvatarFallback>MR</AvatarFallback></Avatar>
            <span className="text-xs font-semibold text-foreground">Maria R.</span>
            <span className="ml-auto text-xs font-bold text-foreground tnum">42 jobs</span>
          </div>
        </div>
        <div className="rounded-control border border-border bg-card p-3">
          <p className="text-[11px] font-bold text-foreground">Busiest day</p>
          <p className="mt-2 text-xs text-muted-foreground">Fridays run <span className="font-bold text-foreground">2.3x</span> your Monday volume.</p>
        </div>
      </div>
    </div>
  )
}

// --- Crew --------------------------------------------------------------------

function CrewTab() {
  const crew = [
    { initials: 'MR', name: 'Maria R.', jobs: 42, rating: 'Payouts on', payoutOk: true, pct: '80%' },
    { initials: 'JT', name: 'James T.', jobs: 31, rating: 'Payouts on', payoutOk: true, pct: '75%' },
    { initials: 'AL', name: 'Ana L.', jobs: 18, rating: 'Finish setup', payoutOk: false, pct: '80%' },
  ]
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        {crew.map((c) => (
          <div key={c.initials} className="flex items-center gap-3 rounded-control border border-border bg-card px-3.5 py-3">
            <Avatar className="size-9 text-[11px]"><AvatarFallback>{c.initials}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{c.name}</p>
              <p className="text-xs text-muted-foreground tnum">{c.jobs} jobs · {c.pct} payout</p>
            </div>
            {c.payoutOk ? (
              <Badge variant="positive" className="px-2 py-0.5 text-[10px]"><CheckCircle2 className="size-3" aria-hidden />{c.rating}</Badge>
            ) : (
              <Badge variant="caution" className="px-2 py-0.5 text-[10px]"><AlertTriangle className="size-3" aria-hidden />{c.rating}</Badge>
            )}
          </div>
        ))}
      </div>
      <div className="rounded-control border border-border bg-card p-3.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-foreground"><ShieldCheck className="size-3.5 text-accent-foreground" aria-hidden />Manager permissions</p>
        <div className="mt-2.5 grid gap-2">
          {[
            { label: 'View payments', on: true },
            { label: 'Manage cleaners', on: true },
            { label: 'Edit bookings', on: true },
            { label: 'Send invites', on: false },
          ].map((p) => (
            <div key={p.label} className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{p.label}</span>
              <Switch checked={p.on} tabIndex={-1} aria-readonly className="pointer-events-none h-5 w-9 [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-4" />
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[10px] text-muted-foreground">Give each manager exactly the access they need, nothing more.</p>
      </div>
    </div>
  )
}

// --- Payments ----------------------------------------------------------------

function PaymentsTab() {
  const [cardFixed, setCardFixed] = React.useState(false)
  const [toast, setToast] = React.useState<string | null>(null)
  const say = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-control border border-border bg-card p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Collected this week</p>
          <p className="mt-0.5 text-lg font-extrabold text-foreground tnum"><AnimatedNumber value={3860} prefix="$" /></p>
        </div>
        <div className="rounded-control border border-border bg-card p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">In transit</p>
          <p className="mt-0.5 text-lg font-extrabold text-foreground tnum">$1,204</p>
        </div>
        <div className="rounded-control border border-border bg-card p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Next payout</p>
          <p className="mt-0.5 text-lg font-extrabold text-foreground tnum">Fri</p>
        </div>
      </div>
      {/* failure queue mirrors PaymentsTriageBand: plain card, critical badge */}
      <div className="rounded-control border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="critical" className="px-2 py-0.5 text-[10px]">Failed charges</Badge>
          <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">{cardFixed ? 0 : 1}</Badge>
        </div>
        <div className="flex items-center justify-between rounded-chip border border-border bg-background px-3 py-2 text-xs">
          <span className="min-w-0">
            {cardFixed ? (
              <>
                <span className="block truncate font-semibold text-positive-700">Chen home · $140 collected</span>
                <span className="block text-[10px] text-muted-foreground">New card on file</span>
              </>
            ) : (
              <>
                <span className="block truncate font-semibold text-foreground">Chen home · $140</span>
                <span className="block text-[10px] text-muted-foreground">Card charge failed</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              disabled={cardFixed}
              onClick={() => {
                setCardFixed(true)
                say('New card saved. Charge collected.')
              }}
            >
              Fix card
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => {
                navigator.clipboard?.writeText('https://demo.nexxus.app/card-link').catch(() => {})
                say('Card update link copied. Text it to the customer.')
              }}
            >
              Copy card link
            </Button>
          </span>
        </div>
        <AnimatePresence>
          {toast ? (
            <m.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="status" className="mt-2 text-xs font-semibold text-positive-700">
              {toast}
            </m.p>
          ) : null}
        </AnimatePresence>
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <RefreshCw className="size-3" aria-hidden />
          A nightly sweep re-tries failed charges for you.
        </p>
      </div>
      <div className="grid gap-1.5">
        {[
          { who: 'Harbor View · Move-out', amt: '$220', state: 'Paid', variant: 'positive' as const },
          { who: 'Cedar Ct · Deep clean', amt: '$180', state: 'Awaiting completion', variant: 'caution' as const },
        ].map((r) => (
          <div key={r.who} className="flex items-center justify-between rounded-control border border-border bg-card px-3.5 py-2.5 text-xs">
            <span className="font-semibold text-foreground">{r.who}</span>
            <span className="flex items-center gap-2"><span className="font-bold text-foreground tnum">{r.amt}</span><Badge variant={r.variant} className="px-2 py-0.5 text-[10px]">{r.state}</Badge></span>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Messages ----------------------------------------------------------------

function MessagesTab() {
  return (
    <div className="grid gap-2">
      <p className="px-1 text-[11px] font-bold text-foreground">Job thread · 8 Cedar Ct</p>
      <div className="grid gap-2 rounded-control border border-border bg-card p-3">
        <div className="flex justify-start">
          <div className="max-w-[75%] rounded-card rounded-tl-chip bg-muted px-3 py-2 text-xs text-foreground">
            <p className="mb-0.5 text-[10px] font-semibold text-muted-foreground">Sarah (customer)</p>
            Gate code is 4412. The dog is friendly!
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-card rounded-tr-chip bg-primary px-3 py-2 text-xs text-primary-foreground">
            <p className="mb-0.5 text-[10px] font-semibold text-brand-100">Office</p>
            Thanks! Maria is on her way, ETA 9:00.
          </div>
        </div>
        <div className="flex justify-start">
          <div className="max-w-[75%] rounded-card rounded-tl-chip bg-muted px-3 py-2 text-xs text-foreground">
            <p className="mb-0.5 text-[10px] font-semibold text-muted-foreground">Maria (cleaner)</p>
            Arrived and starting now. Will send photos when done.
          </div>
        </div>
      </div>
      <p className="px-1 text-[10px] text-muted-foreground">
        Office, cleaner, and customer in one thread per job. Reply as the company; nobody trades personal numbers.
      </p>
    </div>
  )
}

const TAB_CONTENT: Record<TabId, React.ComponentType> = {
  overview: OverviewTab,
  analytics: AnalyticsTab,
  crew: CrewTab,
  payments: PaymentsTab,
  messages: MessagesTab,
}

export function CapabilityExplorer() {
  const [tab, setTab] = React.useState<TabId>('overview')
  const Content = TAB_CONTENT[tab]
  return (
    <section id="try-it" className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="secondary">The whole operation</Badge>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          One place to run all of it
        </h2>
        <p className="mt-3 text-base font-medium text-muted-foreground">
          Click through the real screens with a demo company loaded. Assign a job, read the numbers,
          check a cleaner, chase a payment. Nothing here can break.
        </p>
      </div>

      <div className="mt-8">
        <BrowserFrame label="app.nexxus · Brightside Cleaning Co · demo data">
          <div className="flex">
            <MiniRail />
            <div className="min-w-0 flex-1 bg-background p-4 sm:p-5">
              {/* tab bar */}
              <div className="mb-4 flex gap-1 overflow-x-auto rounded-pill bg-muted p-1">
                {TABS.map((t) => {
                  const active = t.id === tab
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-xs font-semibold transition-all duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'bg-card text-foreground shadow-soft-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <t.Icon className="size-4" aria-hidden />
                      {t.label}
                    </button>
                  )
                })}
              </div>
              <AnimatePresence mode="wait">
                <m.div
                  key={tab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: EASE }}
                >
                  <Content />
                </m.div>
              </AnimatePresence>
            </div>
          </div>
        </BrowserFrame>
      </div>
    </section>
  )
}
