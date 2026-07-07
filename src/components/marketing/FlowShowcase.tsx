'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useMotionValue, useReducedMotion } from 'motion/react'
import {
  CheckCircle2,
  Clock,
  CreditCard,
  ListChecks,
  Camera,
  MousePointer2,
  Sparkles,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'
import { BrowserFrame, MiniRail, PhoneFrame } from './frames'

// ---------------------------------------------------------------------------
// One booking travels through Nexxus as a single continuous ~21s loop:
// request (homeowner) -> needs-you-now queue -> assign (cursor) -> cleaner's
// day -> work montage -> complete -> charge + split. Fixed stage coordinates
// make the flights, connector paths, and cursor deterministic; a camera pans
// across the stage on narrow viewports instead of shrinking the UI.
// See specs/landing-flow-animation.md.
// ---------------------------------------------------------------------------

const EASE = [0.22, 1, 0.36, 1] as const

const STAGE_W = 1060
const STAGE_H = 420

// Surface origins (stage px)
const HOME = { x: 0, y: 56, w: 252 }
const DASH = { x: 306, y: 12, w: 460 }
const CLEAN = { x: 812, y: 56, w: 248 }

// The timeline. Each cue is a named moment; everything derives from the
// current cue, and motion's own transitions carry the in-betweens.
const CUES = [
  { at: 0, name: 'request' },
  { at: 1700, name: 'sendPress' },
  { at: 2400, name: 'flightA' },
  { at: 3300, name: 'inbox' },
  { at: 4800, name: 'cursorIn' },
  { at: 5700, name: 'pickerOpen' },
  { at: 6500, name: 'pickMaria' },
  { at: 7100, name: 'assigned' },
  { at: 7900, name: 'flightB' },
  { at: 8800, name: 'cleanerNew' },
  { at: 10200, name: 'started' },
  { at: 12000, name: 'photos' },
  { at: 13400, name: 'checklist' },
  { at: 14800, name: 'completePress' },
  { at: 15800, name: 'charge' },
  { at: 17000, name: 'split' },
  { at: 18800, name: 'settle' },
] as const
const DURATION = 21500

type CueName = (typeof CUES)[number]['name']
const CUE_INDEX: Record<CueName, number> = Object.fromEntries(
  CUES.map((c, i) => [c.name, i]),
) as Record<CueName, number>

const CAPTIONS: Array<{ from: CueName; text: string }> = [
  { from: 'request', text: 'Sarah requests a deep clean from her phone. Her card is saved, nothing is charged.' },
  { from: 'inbox', text: 'The request lands in your Needs-you-now queue.' },
  { from: 'pickerOpen', text: 'One click assigns Maria.' },
  { from: 'cleanerNew', text: 'Maria gets the job on her phone and starts her day.' },
  { from: 'photos', text: 'Photos and checklist, done as she works.' },
  { from: 'charge', text: 'Job complete: the saved card is charged and the split pays everyone at once.' },
  { from: 'settle', text: 'Booked to paid, with nobody chasing anybody.' },
]

const MARKERS: Array<{ label: string; cue: CueName }> = [
  { label: 'Booked', cue: 'request' },
  { label: 'Assigned', cue: 'cursorIn' },
  { label: 'Done', cue: 'started' },
  { label: 'Paid', cue: 'charge' },
]

// Camera focus (stage x of the point of interest) per stretch of the story.
function focusFor(cue: number): number {
  if (cue < CUE_INDEX.flightA) return HOME.x + HOME.w / 2
  if (cue < CUE_INDEX.flightB) return DASH.x + DASH.w / 2
  if (cue < CUE_INDEX.charge) return CLEAN.x + CLEAN.w / 2
  return DASH.x + DASH.w / 2
}

function useFlowClock(reduced: boolean) {
  const [cue, setCue] = React.useState(reduced ? CUES.length - 1 : 0)
  const progress = useMotionValue(reduced ? 1 : 0)
  const tRef = React.useRef(0)
  const cueRef = React.useRef(cue)
  const pausedRef = React.useRef(false)
  const [userPaused, setUserPaused] = React.useState(false)
  const inViewRef = React.useRef(true)
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (reduced) return
    const node = rootRef.current
    let io: IntersectionObserver | undefined
    if (node) {
      io = new IntersectionObserver(([e]) => { inViewRef.current = e.isIntersecting }, { threshold: 0.25 })
      io.observe(node)
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (!pausedRef.current && inViewRef.current && !document.hidden) {
        tRef.current = (tRef.current + dt) % DURATION
        progress.set(tRef.current / DURATION)
        let idx = 0
        for (let i = 0; i < CUES.length; i++) if (tRef.current >= CUES[i].at) idx = i
        if (idx !== cueRef.current) {
          cueRef.current = idx
          setCue(idx)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [reduced, progress])

  const seek = React.useCallback((cueName: CueName) => {
    tRef.current = CUES[CUE_INDEX[cueName]].at
    progress.set(tRef.current / DURATION)
    cueRef.current = CUE_INDEX[cueName]
    setCue(CUE_INDEX[cueName])
  }, [progress])

  const setPaused = React.useCallback((p: boolean) => {
    pausedRef.current = p
    setUserPaused(p)
  }, [])

  return { cue, progress, seek, setPaused, userPaused, rootRef }
}

// --- tiny building blocks --------------------------------------------------

function Pop({ show, children, delay = 0, className }: { show: boolean; children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <AnimatePresence>
      {show ? (
        <m.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          transition={{ duration: 0.45, ease: EASE, delay }}
          className={className}
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}

function MiniKpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-control border border-border bg-card px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <p className="text-base font-extrabold text-foreground tnum">{children}</p>
    </div>
  )
}

function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="relative inline-flex size-2" aria-hidden>
      {live ? <span className="absolute inline-flex size-full animate-ping rounded-pill bg-positive opacity-60" /> : null}
      <span className={cn('relative inline-flex size-2 rounded-pill', live ? 'bg-positive' : 'bg-warm-300')} />
    </span>
  )
}

// --- surfaces ---------------------------------------------------------------

function HomeownerSurface({ cue }: { cue: number }) {
  const sent = cue >= CUE_INDEX.flightA
  const scheduled = cue >= CUE_INDEX.assigned
  const inProgress = cue >= CUE_INDEX.started
  const paid = cue >= CUE_INDEX.charge
  const pressed = cue === CUE_INDEX.sendPress
  return (
    <div className="grid grid-cols-1 gap-2 text-left">
      <Badge variant="secondary" className="justify-self-start px-2 py-0.5 text-[10px]">Sarah · customer</Badge>
      {!sent ? (
        <>
          <p className="text-[13px] font-bold text-foreground">Request a cleaning</p>
          <div className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-foreground"><Sparkles className="size-3.5 text-accent-foreground" aria-hidden />Deep clean</span>
            <span className="font-bold text-foreground tnum">$180</span>
          </div>
          <div className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-foreground"><Clock className="size-3.5 text-muted-foreground" aria-hidden />Thu · 9:00 AM</span>
            <span className="text-[10px] text-muted-foreground">1st pick</span>
          </div>
          <div className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-foreground"><CreditCard className="size-3.5 text-muted-foreground" aria-hidden />Visa ·· 4242</span>
            <span className="text-[10px] text-muted-foreground">at completion</span>
          </div>
          <m.div animate={{ scale: pressed ? 0.95 : 1 }} transition={{ duration: 0.18 }}>
            <Button size="sm" className="h-8 w-full text-xs" tabIndex={-1}>Send request</Button>
          </m.div>
          <Badge variant="positive" className="justify-self-start px-2 py-0.5 text-[10px]">No upfront hold</Badge>
        </>
      ) : (
        <>
          {!scheduled ? (
            <Pop show className="grid gap-2">
              <div className="flex items-center gap-2 rounded-control border border-border bg-card px-2.5 py-2.5 text-[11px]">
                <CheckCircle2 className="size-4 shrink-0 text-positive-700" aria-hidden />
                <span className="font-semibold text-foreground">Request sent. The office will confirm your time.</span>
              </div>
            </Pop>
          ) : (
            <Pop show className="grid gap-2">
              <div className={cn(
                'rounded-card p-3 text-primary-foreground shadow-soft-md',
                'bg-gradient-to-br from-brand-600 to-brand-500',
              )}>
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-brand-100">
                  {paid ? 'Cleaning complete' : inProgress ? 'Cleaning in progress' : 'Your next cleaning'}
                </p>
                <p className="mt-1 text-sm font-extrabold tnum">Thu · 9:00 AM</p>
                <p className="text-[10px] text-brand-100">8 Cedar Ct · Deep clean</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <Avatar className="size-5 text-[8px]"><AvatarFallback className="bg-card/25 text-primary-foreground">MR</AvatarFallback></Avatar>
                  <span className="text-[10px] font-semibold">Maria R. · your cleaner</span>
                  {inProgress && !paid ? <span className="ml-auto"><LiveDot live /></span> : null}
                </div>
              </div>
            </Pop>
          )}
          <Pop show={paid}>
            <div className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
              <span className="flex items-center gap-1.5 font-semibold text-foreground"><CreditCard className="size-3.5 text-muted-foreground" aria-hidden />Visa ·· 4242</span>
              <Badge variant="positive" className="px-2 py-0.5 text-[10px]">Paid $180</Badge>
            </div>
          </Pop>
        </>
      )}
    </div>
  )
}

function OperatorSurface({ cue }: { cue: number }) {
  const hasRequest = cue >= CUE_INDEX.inbox
  const assigned = cue >= CUE_INDEX.assigned
  const started = cue >= CUE_INDEX.started
  const completed = cue >= CUE_INDEX.charge
  const needsYou = hasRequest && !assigned ? 1 : 0
  const revenue = completed ? 12657 : 12477
  return (
    <div className="flex">
      <MiniRail />
      <div className="min-w-0 flex-1 bg-background p-3 text-left">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-bold text-foreground">Good morning, Dana</p>
          <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">Brightside Cleaning Co</Badge>
        </div>
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          <MiniKpi label="Today's jobs">6</MiniKpi>
          <MiniKpi label="Needs you"><AnimatedNumber value={needsYou} /></MiniKpi>
          <MiniKpi label="Revenue this month"><AnimatedNumber value={revenue} prefix="$" /></MiniKpi>
        </div>

        <div className="rounded-control border border-border bg-card p-2">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <p className="text-[11px] font-bold text-foreground">Needs you now</p>
            <AnimatePresence mode="popLayout">
              {needsYou > 0 ? (
                <m.span key="count" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
                  <Badge variant="caution" className="px-1.5 py-0 text-[9px]">1</Badge>
                </m.span>
              ) : null}
            </AnimatePresence>
          </div>
          {!hasRequest ? (
            <div className="flex items-center gap-1.5 rounded-chip bg-background px-2 py-2 text-[10px] font-medium text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-positive-700" aria-hidden />
              You&apos;re all caught up
            </div>
          ) : (
            <Pop show className="relative">
              <div
                id="flow-queue-row"
                className={cn(
                  'flex items-center justify-between gap-2 rounded-chip border bg-background px-2 py-1.5 transition-colors duration-base',
                  cue >= CUE_INDEX.cursorIn && !assigned ? 'border-brand-300' : 'border-border',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-semibold text-foreground">8 Cedar Ct · Deep clean</span>
                  <span className="block text-[9px] text-muted-foreground">Thu · 9:00 AM · Sarah K.</span>
                </span>
                {!assigned ? (
                  <span className="inline-flex shrink-0 items-center rounded-pill bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground shadow-soft-sm">
                    Assign
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <Avatar className="size-4 text-[7px]"><AvatarFallback>MR</AvatarFallback></Avatar>
                    <StatusPill status={completed ? 'completed' : started ? 'in_progress' : 'scheduled'} label={completed ? 'Completed' : started ? 'In progress' : 'Confirmed'} className="px-1.5 py-0 text-[9px]" />
                  </span>
                )}
              </div>
              {/* assign picker */}
              <AnimatePresence>
                {cue >= CUE_INDEX.pickerOpen && !assigned ? (
                  <m.div
                    initial={{ opacity: 0, y: 4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="absolute right-0 top-full z-20 mt-1 w-36 rounded-control border border-border bg-card p-1 shadow-soft-lg"
                  >
                    <div className={cn('flex items-center gap-1.5 rounded-chip px-2 py-1.5 text-[10px] font-semibold text-foreground', cue >= CUE_INDEX.pickMaria && 'bg-accent text-accent-foreground')}>
                      <Avatar className="size-4 text-[7px]"><AvatarFallback>MR</AvatarFallback></Avatar>
                      Maria R.
                    </div>
                    <div className="flex items-center gap-1.5 rounded-chip px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
                      <Avatar className="size-4 text-[7px]"><AvatarFallback>JT</AvatarFallback></Avatar>
                      James T.
                    </div>
                  </m.div>
                ) : null}
              </AnimatePresence>
            </Pop>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <div className="rounded-control border border-border bg-card p-2">
            <p className="px-1 pb-1 text-[11px] font-bold text-foreground">Today&apos;s schedule</p>
            <div className="grid gap-1 text-[10px]">
              <div className="flex gap-2 px-1"><span className="w-9 font-bold text-accent-foreground tnum">8:00</span><span className="truncate text-muted-foreground">Chen home · Maria R.</span></div>
              <div className="flex gap-2 px-1"><span className="w-9 font-bold text-accent-foreground tnum">1:30</span><span className="truncate text-muted-foreground">Harbor View · James T.</span></div>
              <AnimatePresence>
                {assigned ? (
                  <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2 px-1">
                    <span className="w-9 font-bold text-accent-foreground tnum">9:00</span>
                    <span className="truncate text-muted-foreground">8 Cedar Ct · Maria R.</span>
                  </m.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
          <div className="rounded-control border border-border bg-card p-2">
            <p className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-bold text-foreground">
              <LiveDot live={started && !completed} />
              Active now
            </p>
            {started && !completed ? (
              <Pop show className="px-1 text-[10px] font-medium text-muted-foreground">8 Cedar Ct · Maria R.</Pop>
            ) : (
              <p className="px-1 text-[10px] text-muted-foreground">{completed ? 'All wrapped for now' : 'No jobs in progress'}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CleanerSurface({ cue }: { cue: number }) {
  const hasJob = cue >= CUE_INDEX.cleanerNew
  const started = cue >= CUE_INDEX.started
  const photosDone = cue >= CUE_INDEX.photos
  const checklistDone = cue >= CUE_INDEX.checklist
  const pressed = cue === CUE_INDEX.completePress
  const paidOut = cue >= CUE_INDEX.split
  return (
    <div className="grid grid-cols-1 gap-2 text-left">
      <Badge variant="secondary" className="justify-self-start px-2 py-0.5 text-[10px]">Maria · cleaner</Badge>
      {!started ? (
        <>
          <p className="text-[13px] font-bold text-foreground">Your Thursday</p>
          <div className="flex items-center gap-2 rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
            <span className="w-8 shrink-0 text-center font-extrabold text-foreground tnum">8:00</span>
            <span className="h-6 w-px bg-border" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">Chen home</span>
            <StatusPill status="completed" label="Done" className="px-1.5 py-0 text-[9px]" />
          </div>
          <Pop show={hasJob}>
            <div className="flex items-center gap-2 rounded-control border border-brand-200 bg-accent px-2.5 py-2 text-[11px]">
              <span className="w-8 shrink-0 text-center font-extrabold text-foreground tnum">9:00</span>
              <span className="h-6 w-px bg-brand-200" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-foreground">Sarah K. · Deep clean</span>
                <span className="block text-[9px] text-muted-foreground">8 Cedar Ct</span>
              </span>
              <Badge className="px-1.5 py-0 text-[9px]">New</Badge>
            </div>
          </Pop>
          {hasJob ? (
            <Pop show delay={0.5}>
              <Button size="sm" className="h-8 w-full text-xs" tabIndex={-1}>Start job · directions</Button>
            </Pop>
          ) : null}
        </>
      ) : (
        <Pop show className="grid gap-2">
          <div className="rounded-card bg-brand-600 p-3 text-primary-foreground shadow-soft-md">
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-brand-100">Active job</p>
            <p className="mt-0.5 text-sm font-extrabold">8 Cedar Ct</p>
            <p className="text-[10px] text-brand-100">Deep clean · Sarah K.</p>
          </div>
          <div className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-foreground"><Camera className="size-3.5 text-muted-foreground" aria-hidden />Photos</span>
            {photosDone ? (
              <Badge variant="positive" className="px-1.5 py-0 text-[9px]">3 added</Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground">before + after</span>
            )}
          </div>
          <div className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-foreground"><ListChecks className="size-3.5 text-muted-foreground" aria-hidden />Checklist</span>
            {checklistDone ? (
              <Badge variant="positive" className="px-1.5 py-0 text-[9px]">8 of 8 done</Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground tnum">{photosDone ? '5 of 8' : '2 of 8'}</span>
            )}
          </div>
          {!paidOut ? (
            <m.div animate={{ scale: pressed ? 0.95 : 1 }} transition={{ duration: 0.18 }}>
              <Button size="sm" className="h-8 w-full text-xs" disabled={!checklistDone} tabIndex={-1}>
                Complete job
              </Button>
            </m.div>
          ) : (
            <Pop show>
              <div className="flex items-center gap-2 rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
                <CheckCircle2 className="size-4 shrink-0 text-positive-700" aria-hidden />
                <span className="font-semibold text-foreground">Your cut of <span className="tnum">$144</span> is on its way.</span>
              </div>
            </Pop>
          )}
        </Pop>
      )}
    </div>
  )
}

// --- stage-level actors ------------------------------------------------------

/** The booking artifact in flight, plus the money chips. Explicit coordinate
 *  keyframes in stage space: deterministic, transform-only. */
function FlightLayer({ cue }: { cue: number }) {
  const flights: React.ReactNode[] = []

  if (cue === CUE_INDEX.flightA) {
    flights.push(
      <m.div
        key="flightA"
        initial={{ x: HOME.x + 126, y: 330, opacity: 0, scale: 0.8 }}
        animate={{ x: [HOME.x + 126, HOME.x + 250, DASH.x + 150], y: [330, 220, 208], opacity: [0, 1, 1], scale: [0.8, 1, 0.95] }}
        transition={{ duration: 0.85, ease: EASE, times: [0, 0.35, 1] }}
        className="absolute left-0 top-0 z-30 flex items-center gap-1.5 rounded-pill border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground shadow-soft-lg"
      >
        <Sparkles className="size-3.5 text-accent-foreground" aria-hidden />
        Deep clean · Thu 9:00
      </m.div>,
    )
  }
  if (cue === CUE_INDEX.flightB) {
    flights.push(
      <m.div
        key="flightB"
        initial={{ x: DASH.x + 300, y: 210, opacity: 0, scale: 0.9 }}
        animate={{ x: [DASH.x + 300, DASH.x + 470, CLEAN.x + 40], y: [210, 160, 200], opacity: [0, 1, 1], scale: [0.9, 1, 0.95] }}
        transition={{ duration: 0.85, ease: EASE, times: [0, 0.4, 1] }}
        className="absolute left-0 top-0 z-30 flex items-center gap-1.5 rounded-pill border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground shadow-soft-lg"
      >
        <Avatar className="size-4 text-[7px]"><AvatarFallback>MR</AvatarFallback></Avatar>
        Thu 9:00 · Sarah K.
      </m.div>,
    )
  }
  if (cue === CUE_INDEX.charge) {
    flights.push(
      <m.div
        key="charge"
        initial={{ x: HOME.x + 130, y: 330, opacity: 0 }}
        animate={{ x: [HOME.x + 130, DASH.x + 40, DASH.x + 210], y: [330, 315, 115], opacity: [0, 1, 1] }}
        transition={{ duration: 1.0, ease: EASE, times: [0, 0.5, 1] }}
        className="absolute left-0 top-0 z-30 flex items-center gap-1.5 rounded-pill border border-border bg-card px-3 py-1.5 text-[11px] font-bold text-foreground shadow-soft-lg tnum"
      >
        <CreditCard className="size-3.5 text-accent-foreground" aria-hidden />
        $180 charged
      </m.div>,
    )
  }
  if (cue === CUE_INDEX.split) {
    flights.push(
      <m.div
        key="splitCleaner"
        initial={{ x: DASH.x + 250, y: 130, opacity: 0 }}
        animate={{ x: [DASH.x + 250, DASH.x + 480, CLEAN.x + 30], y: [130, 100, 330], opacity: [0, 1, 1] }}
        transition={{ duration: 1.0, ease: EASE, times: [0, 0.45, 1] }}
        className="absolute left-0 top-0 z-30 rounded-pill bg-positive-50 px-3 py-1.5 text-[11px] font-bold text-positive-700 shadow-soft-md tnum"
      >
        $144 to Maria
      </m.div>,
      <m.div
        key="splitCompany"
        initial={{ x: DASH.x + 250, y: 130, opacity: 0, scale: 0.9 }}
        animate={{ x: DASH.x + 318, y: 102, opacity: [0, 1], scale: 1 }}
        transition={{ duration: 0.8, ease: EASE }}
        className="absolute left-0 top-0 z-30 rounded-pill bg-positive-50 px-3 py-1.5 text-[11px] font-bold text-positive-700 shadow-soft-md tnum"
      >
        $36 to Brightside
      </m.div>,
    )
  }
  return <AnimatePresence>{flights}</AnimatePresence>
}

/** Curved connectors that draw themselves under a flight, then fade. */
function ConnectorLayer({ cue }: { cue: number }) {
  const aActive = cue >= CUE_INDEX.flightA && cue < CUE_INDEX.cursorIn
  const bActive = cue >= CUE_INDEX.flightB && cue < CUE_INDEX.started
  const moneyActive = cue >= CUE_INDEX.charge && cue < CUE_INDEX.settle
  const seg = (d: string, active: boolean, key: string) => (
    <m.path
      key={key}
      d={d}
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeDasharray="1 1"
      className="stroke-brand-300"
      pathLength={1}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: active ? 1 : 0, opacity: active ? 0.9 : 0 }}
      transition={{ pathLength: { duration: 0.85, ease: EASE }, opacity: { duration: 0.4 } }}
    />
  )
  return (
    <svg className="absolute inset-0 z-0" width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} aria-hidden>
      {seg(`M ${HOME.x + 200} 330 C ${HOME.x + 300} 320, ${DASH.x - 20} 240, ${DASH.x + 140} 215`, aActive, 'a')}
      {seg(`M ${DASH.x + 380} 205 C ${DASH.x + 480} 170, ${CLEAN.x - 30} 180, ${CLEAN.x + 60} 215`, bActive, 'b')}
      {seg(`M ${HOME.x + 180} 335 C ${DASH.x - 40} 335, ${DASH.x + 60} 310, ${DASH.x + 210} 125`, moneyActive, 'm1')}
      {seg(`M ${DASH.x + 260} 120 C ${DASH.x + 500} 85, ${CLEAN.x - 20} 190, ${CLEAN.x + 50} 330`, moneyActive, 'm2')}
    </svg>
  )
}

/** Simulated operator cursor for the one human action: assigning Maria. */
function CursorLayer({ cue }: { cue: number }) {
  const visible = cue >= CUE_INDEX.cursorIn && cue < CUE_INDEX.flightB
  // Stage coordinates: the queue row's Assign chip, then the Maria option.
  const target =
    cue >= CUE_INDEX.pickMaria
      ? { x: DASH.x + 330, y: 262 }
      : cue >= CUE_INDEX.cursorIn
        ? { x: DASH.x + 395, y: 212 }
        : { x: DASH.x + 460, y: 420 }
  const clicking = cue === CUE_INDEX.pickerOpen || cue === CUE_INDEX.assigned
  return (
    <AnimatePresence>
      {visible ? (
        <m.div
          key="cursor"
          initial={{ x: DASH.x + 460, y: 420, opacity: 0 }}
          animate={{ x: target.x, y: target.y, opacity: 1, scale: clicking ? 0.82 : 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          transition={{ x: { type: 'spring', stiffness: 120, damping: 20 }, y: { type: 'spring', stiffness: 120, damping: 20 }, scale: { duration: 0.15 } }}
          className="absolute left-0 top-0 z-40"
          aria-hidden
        >
          <MousePointer2 className="size-5 fill-foreground stroke-background drop-shadow" />
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}

// --- the showcase ------------------------------------------------------------

export function FlowShowcase() {
  const reduced = useReducedMotion() ?? false
  const { cue, progress, seek, setPaused, rootRef } = useFlowClock(reduced)
  const [containerW, setContainerW] = React.useState<number | null>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const ro = new ResizeObserver(([entry]) => setContainerW(entry.contentRect.width))
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const cw = containerW ?? STAGE_W
  const scale = cw >= STAGE_W ? 1 : Math.min(1, cw / 520)
  const panning = cw < STAGE_W * scale + 1
  const focusX = focusFor(cue)
  const camX = panning
    ? Math.min(0, Math.max(cw - STAGE_W * scale, cw / 2 - focusX * scale))
    : (cw - STAGE_W * scale) / 2

  const caption =
    reduced
      ? 'One booking, from request to payout, with nobody chasing anybody.'
      : [...CAPTIONS].reverse().find((c) => cue >= CUE_INDEX[c.from])?.text ?? CAPTIONS[0].text

  return (
    <div ref={rootRef} id="flow-showcase">
      <div
        ref={viewportRef}
        className="relative overflow-hidden"
        style={{ height: STAGE_H * scale }}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        aria-hidden
      >
        <m.div
          className="absolute left-0 top-0"
          style={{ width: STAGE_W, height: STAGE_H, transformOrigin: '0 0' }}
          animate={{ x: camX, scale }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 60, damping: 20 }}
        >
          <ConnectorLayer cue={cue} />
          <div className="absolute z-10" style={{ left: HOME.x, top: HOME.y, width: HOME.w }}>
            <PhoneFrame>
              <HomeownerSurface cue={cue} />
            </PhoneFrame>
          </div>
          <div className="absolute z-10" style={{ left: DASH.x, top: DASH.y, width: DASH.w }}>
            <BrowserFrame label="app.nexxus · demo data">
              <OperatorSurface cue={cue} />
            </BrowserFrame>
          </div>
          <div className="absolute z-10" style={{ left: CLEAN.x, top: CLEAN.y, width: CLEAN.w }}>
            <PhoneFrame>
              <CleanerSurface cue={cue} />
            </PhoneFrame>
          </div>
          {!reduced ? (
            <>
              <FlightLayer cue={cue} />
              <CursorLayer cue={cue} />
            </>
          ) : null}
        </m.div>
      </div>

      {/* progress rail: a clock, not a stepper */}
      <div className="mx-auto mt-6 w-full max-w-md px-2">
        <div className="relative h-1 rounded-pill bg-warm-200">
          <m.div className="absolute inset-y-0 left-0 w-full rounded-pill bg-primary" style={{ scaleX: progress, transformOrigin: '0 50%' }} />
        </div>
        <div className="mt-2 flex justify-between">
          {MARKERS.map((mk) => (
            <button
              key={mk.label}
              type="button"
              onClick={() => seek(mk.cue)}
              className={cn(
                'rounded-pill px-2 py-0.5 text-xs font-semibold transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                cue >= CUE_INDEX[mk.cue] ? 'text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {mk.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mx-auto mt-3 min-h-10 max-w-md text-center text-sm font-medium text-muted-foreground" aria-live="polite">
        {caption}
      </p>
    </div>
  )
}
