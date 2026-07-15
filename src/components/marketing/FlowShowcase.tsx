'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useMotionValue, useReducedMotion } from 'motion/react'
import {
  CheckCircle2,
  Clock,
  CreditCard,
  ListChecks,
  Camera,
  Inbox,
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
import { HOMEOWNER_NAV } from '@/components/redesign/homeowner/shell/homeowner-nav-items'
import { CLEANER_NAV } from '@/components/redesign/cleaner/shell/cleaner-nav-items'

const HOMEOWNER_TABS = HOMEOWNER_NAV.map((i) => i.icon)  // 4: Home, Cleanings, Messages, Account
const CLEANER_TABS = CLEANER_NAV.map((i) => i.icon)      // 5: Today, Schedule, Earnings, Messages, Profile

// ---------------------------------------------------------------------------
// One booking travels through Nexxus as a single continuous ~24s loop. The
// request collapses into an appointment card, glides along a drawn path into
// the Needs-you-now queue (drop-target glow, landing settle), a cursor assigns
// Maria, the job glides to her phone, the work montage ticks by, and on
// completion the camera pans back for the money beat: the pill flips to
// Completed, revenue rolls up, and Maria's payout counts in.
// Fixed stage coordinates; a spring camera pans on narrow viewports.
// See specs/landing-flow-animation.md.
// ---------------------------------------------------------------------------

const EASE = [0.22, 1, 0.36, 1] as const
const GLIDE: [number, number, number, number] = [0.45, 0.05, 0.25, 1]

const STAGE_W = 1060
const STAGE_H = 420

// Three frames on a shared top edge at y=30, with the label band above them in
// y 0..24. The old composition staggered them (dash y=12, phones y=56); that is
// dropped, because a shared label baseline over staggered frames leaves an
// uneven label-to-frame gap. With the app bar the dashboard lands near 380 tall
// anyway, the same as the phones, so the three align. The dashboard still
// dominates at 460 wide against 220.
const HOME = { x: 0, y: 30, w: 220, h: 380 }
const DASH = { x: 300, y: 30, w: 460 }
const CLEAN = { x: 840, y: 30, w: 220, h: 380 }

// Card centers, used by the motion paths (offset-path follows these curves).
// Endpoints are measured (not derived on paper) from the rendered centers of
// #flow-request-card, #flow-queue-row, and #flow-job-row via stageCenter's
// own math, polled across a full loop in the browser console. Control points
// sit ~85px above the straight line between endpoints, at roughly one third
// and two thirds across, to keep the arc that reads as flight rather than a
// slide.
// PATH_A ends 552 279, not 552 271: the queue row sits at 279 while
// unassigned (Assign chip), and that's its state at the `drop` cue, when
// this flight lands. It only moves to 271 once `assigned` fires, which is
// where PATH_B departs from below. Same row, two stable heights.
const PATH_A = 'M 110 123 C 257 90, 405 142, 552 279'
const PATH_B = 'M 552 271 C 685 156, 817 125, 950 180'

const FLIGHT_A_MS = 1450
const FLIGHT_B_MS = 1350

const CUES = [
  { at: 0, name: 'request' },
  { at: 1600, name: 'sendPress' },
  { at: 2200, name: 'collapse' },
  { at: 3100, name: 'lift' },
  { at: 4600, name: 'drop' },
  { at: 5900, name: 'cursorIn' },
  { at: 6700, name: 'pickerOpen' },
  { at: 7500, name: 'pickMaria' },
  { at: 8100, name: 'assigned' },
  { at: 9000, name: 'liftB' },
  { at: 10400, name: 'dropB' },
  { at: 11600, name: 'started' },
  { at: 12800, name: 'photo1' },
  { at: 13300, name: 'photo2' },
  { at: 13800, name: 'photo3' },
  { at: 14500, name: 'check1' },
  { at: 15100, name: 'check2' },
  { at: 15800, name: 'checkDone' },
  { at: 16700, name: 'completePress' },
  { at: 17600, name: 'panBack' },
  { at: 18500, name: 'revenue' },
  { at: 20600, name: 'settle' },
] as const
const DURATION = 23000

type CueName = (typeof CUES)[number]['name']
const CUE_INDEX: Record<CueName, number> = Object.fromEntries(
  CUES.map((c, i) => [c.name, i]),
) as Record<CueName, number>

const CAPTIONS: Array<{ from: CueName; text: string }> = [
  { from: 'request', text: 'Sarah requests a deep clean from her phone. Her card is saved, nothing is charged.' },
  { from: 'lift', text: 'The request lands in your Needs-you-now queue.' },
  { from: 'pickerOpen', text: 'One click assigns Maria.' },
  { from: 'liftB', text: 'Maria gets the job on her phone and starts her day.' },
  { from: 'photo1', text: 'Photos and checklist, done as she works.' },
  { from: 'panBack', text: 'Job complete: the saved card is charged and revenue rolls up.' },
  { from: 'settle', text: 'Booked to paid, with nobody chasing anybody.' },
]

const ROLES = [
  { key: 'home', name: 'Sarah', role: 'Customer', x: HOME.x, w: HOME.w },
  { key: 'dash', name: 'Dana', role: 'The office', x: DASH.x, w: DASH.w },
  { key: 'clean', name: 'Maria', role: 'Cleaner', x: CLEAN.x, w: CLEAN.w },
] as const

/** Role labels on a shared baseline above the frames. These are the page's
 *  voice, not product chrome: the frames themselves stay honest screenshots.
 *  "Customer" not "Homeowner" on purpose, see the spec: the operator nav says
 *  "Customers", the hero sells past homes, and demo-data has a rental. */
function StageLabels() {
  return (
    <>
      {ROLES.map((r) => (
        <p
          key={r.key}
          className="absolute top-0 text-center text-xs font-semibold text-muted-foreground"
          style={{ left: r.x, width: r.w }}
        >
          <span className="font-extrabold text-foreground">{r.name}</span> · {r.role}
        </p>
      ))}
    </>
  )
}

function focusFor(cue: number): number {
  if (cue < CUE_INDEX.lift) return HOME.x + HOME.w / 2
  if (cue < CUE_INDEX.liftB) return DASH.x + DASH.w / 2
  if (cue < CUE_INDEX.panBack) return CLEAN.x + CLEAN.w / 2
  return DASH.x + DASH.w / 2
}

function useFlowClock(reduced: boolean) {
  const [cue, setCue] = React.useState(reduced ? CUES.length - 1 : 0)
  const progress = useMotionValue(reduced ? 1 : 0)
  const tRef = React.useRef(0)
  const cueRef = React.useRef(cue)
  const inViewRef = React.useRef(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (reduced) return
    const node = rootRef.current
    if (!node) return
    // Hysteresis: start once the stage reaches the middle band of the
    // viewport; keep playing until it leaves the viewport entirely. This
    // avoids the flappy start/stop right at a threshold edge.
    const enter = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) inViewRef.current = true },
      { rootMargin: '-18% 0px -18% 0px', threshold: 0 },
    )
    const exit = new IntersectionObserver(
      ([e]) => { if (!e.isIntersecting) inViewRef.current = false },
      { threshold: 0 },
    )
    enter.observe(node)
    exit.observe(node)

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100)
      last = now
      if (inViewRef.current && !document.hidden) {
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
      enter.disconnect()
      exit.disconnect()
    }
  }, [reduced, progress])

  const seek = React.useCallback((cueName: CueName) => {
    tRef.current = CUES[CUE_INDEX[cueName]].at
    progress.set(tRef.current / DURATION)
    cueRef.current = CUE_INDEX[cueName]
    setCue(CUE_INDEX[cueName])
  }, [progress])

  return { cue, progress, seek, rootRef }
}

// --- small building blocks ---------------------------------------------------

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

/** Landing settle: drops in with a soft overshoot, like something set down. */
function Land({ show, children, className }: { show: boolean; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence>
      {show ? (
        <m.div
          initial={{ opacity: 0, y: -6, scale: 1.04 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 320, damping: 17 }}
          className={className}
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}

/** Expanding tap ring for simulated touches on the phones. */
function TapRipple({ fire }: { fire: boolean }) {
  return (
    <AnimatePresence>
      {fire ? (
        <m.span
          key="ripple"
          className="pointer-events-none absolute inset-0 z-10 m-auto size-8 rounded-pill bg-primary/25"
          initial={{ scale: 0.2, opacity: 0.8 }}
          animate={{ scale: 2.6, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.65, ease: 'easeOut' }}
          aria-hidden
        />
      ) : null}
    </AnimatePresence>
  )
}

function MiniKpi({ label, emphasized, children }: { label: string; emphasized?: boolean; children: React.ReactNode }) {
  return (
    <m.div
      animate={emphasized ? { scale: [1, 1.07, 1] } : { scale: 1 }}
      transition={{ duration: 0.7, ease: EASE }}
      className={cn(
        'rounded-control border bg-card px-2.5 py-2 transition-shadow duration-slow',
        emphasized ? 'border-brand-300 shadow-soft-md ring-2 ring-brand-200' : 'border-border',
      )}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <p className="text-base font-extrabold text-foreground tnum">{children}</p>
    </m.div>
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

/** The appointment as a physical object: what collapses out of the request
 *  form, flies path A, and sits in the queue. */
function ApptCard() {
  return (
    // This card is a stage overlay, not a child of the phone, so what reads is
    // its width against the frame: 166 keeps it at ~75% of the 220px phone, the
    // ratio it had at 252. The subtitle drops "Sarah K." because at 9px the full
    // string is ~163px and would wrap inside a 166px card, changing its height
    // mid-flight. The name is not lost: the queue row it lands on reads
    // "Thu · 9:00 AM · Sarah K.", and the label above the phone says
    // "Sarah · Customer".
    <div className="w-[166px] rounded-control border border-border bg-card px-3 py-2 shadow-soft-lg">
      <p className="flex items-center justify-between text-[11px] font-bold text-foreground">
        <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-accent-foreground" aria-hidden />Deep clean</span>
        <span className="tnum">$180</span>
      </p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">Thu · 9:00 AM · 8 Cedar Ct</p>
    </div>
  )
}

/** A card gliding along an SVG motion path. */
function GlideAlong({ path, duration, children }: { path: string; duration: number; children: React.ReactNode }) {
  return (
    <m.div
      className="absolute z-30"
      style={{ offsetPath: `path("${path}")`, offsetRotate: '0deg' }}
      initial={{ offsetDistance: '0%', scale: 1, opacity: 0 }}
      animate={{ offsetDistance: '100%', scale: [1, 1.12, 1.02], opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{
        offsetDistance: { duration, ease: GLIDE },
        scale: { duration, times: [0, 0.45, 1], ease: 'easeInOut' },
        opacity: { duration: 0.25 },
      }}
      aria-hidden
    >
      {children}
    </m.div>
  )
}

// --- surfaces ----------------------------------------------------------------

function HomeownerSurface({ cue }: { cue: number }) {
  const collapsed = cue >= CUE_INDEX.collapse
  const lifted = cue >= CUE_INDEX.lift
  const scheduled = cue >= CUE_INDEX.assigned
  const inProgress = cue >= CUE_INDEX.started
  const complete = cue >= CUE_INDEX.panBack
  const paid = cue >= CUE_INDEX.revenue
  return (
    <div className="grid grid-cols-1 content-start gap-2 text-left">
      <AnimatePresence mode="popLayout" initial={false}>
      {!collapsed ? (
        <m.div
          key="form"
          exit={{ opacity: 0, scale: 0.9, y: 20, transition: { duration: 0.35, ease: 'easeIn' } }}
          className="grid grid-cols-1 gap-2"
        >
          <p className="text-[13px] font-bold text-foreground">Request a cleaning</p>
          <div id="flow-request-card" className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
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
          <m.div
            className="relative"
            animate={{ scale: cue === CUE_INDEX.sendPress ? 0.94 : 1 }}
            transition={{ duration: 0.18 }}
          >
            <TapRipple fire={cue === CUE_INDEX.sendPress} />
            <Button size="sm" className="h-8 w-full text-xs" tabIndex={-1}>Send request</Button>
          </m.div>
          <Badge variant="positive" className="justify-self-start px-2 py-0.5 text-[10px]">No upfront hold</Badge>
        </m.div>
      ) : !scheduled ? null : (
        <m.div
          key="hero"
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: EASE }}
          className="grid grid-cols-1 gap-2"
        >
          <div className="rounded-card bg-gradient-to-br from-brand-600 to-brand-500 p-3 text-primary-foreground shadow-soft-md">
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-brand-100">
              {complete ? 'Cleaning complete' : inProgress ? 'Cleaning in progress' : 'Your next cleaning'}
            </p>
            <p className="mt-1 text-sm font-extrabold tnum">Thu · 9:00 AM</p>
            <p className="text-[10px] text-brand-100">8 Cedar Ct · Deep clean</p>
            <div className="mt-2 flex items-center gap-1.5">
              <Avatar className="size-5 text-[8px]"><AvatarFallback className="bg-card/25 text-primary-foreground">MR</AvatarFallback></Avatar>
              <span className="text-[10px] font-semibold">Maria R. · your cleaner</span>
              {inProgress && !complete ? <span className="ml-auto"><LiveDot live /></span> : null}
            </div>
          </div>
          <Pop show={paid}>
            <div className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
              <span className="flex items-center gap-1.5 font-semibold text-foreground"><CreditCard className="size-3.5 text-muted-foreground" aria-hidden />Visa ·· 4242</span>
              <Badge variant="positive" className="px-2 py-0.5 text-[10px]">Paid $180</Badge>
            </div>
          </Pop>
        </m.div>
      )}
      </AnimatePresence>
      {lifted && !scheduled ? (
        <Pop show delay={0.35}>
          <div className="flex items-center gap-2 rounded-control border border-border bg-card px-2.5 py-2.5 text-[11px]">
            <CheckCircle2 className="size-4 shrink-0 text-positive-700" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">Sent. Confirming soon.</span>
          </div>
        </Pop>
      ) : null}
    </div>
  )
}

/** Status pill that flips when its state changes. */
function FlipPill({ children, flipKey }: { children: React.ReactNode; flipKey: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <m.span
        key={flipKey}
        initial={{ rotateX: 90, opacity: 0 }}
        animate={{ rotateX: 0, opacity: 1 }}
        exit={{ rotateX: -90, opacity: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
        className="inline-flex"
      >
        {children}
      </m.span>
    </AnimatePresence>
  )
}

function OperatorSurface({ cue }: { cue: number }) {
  const incoming = cue === CUE_INDEX.lift
  const hasRequest = cue >= CUE_INDEX.drop
  const assigned = cue >= CUE_INDEX.assigned
  const started = cue >= CUE_INDEX.started
  const completed = cue >= CUE_INDEX.panBack
  const revenueBeat = cue >= CUE_INDEX.revenue
  const needsYou = hasRequest && !assigned ? 1 : 0
  const revenue = revenueBeat ? 12657 : 12477

  const pillKey = completed ? 'completed' : started ? 'in_progress' : 'confirmed'

  return (
    <div className="flex">
      <MiniRail variant="app" />
      <div className="min-w-0 flex-1 bg-background p-3 text-left">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-bold text-foreground">Good morning, Dana</p>
          <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">Brightside Cleaning Co</Badge>
        </div>
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          <MiniKpi label="Today's jobs">6</MiniKpi>
          <MiniKpi label="Needs you"><AnimatedNumber value={needsYou} /></MiniKpi>
          <MiniKpi label="Monthly revenue" emphasized={revenueBeat && cue < CUE_INDEX.settle}>
            <AnimatedNumber value={revenue} prefix="$" />
          </MiniKpi>
        </div>

        <div
          className={cn(
            'rounded-control border bg-card p-2 transition-all duration-slow',
            incoming ? 'border-brand-300 ring-2 ring-brand-200' : 'border-border',
          )}
        >
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
            <div className={cn(
              'flex items-center gap-1.5 rounded-chip px-2 py-2 text-[10px] font-medium transition-colors duration-slow',
              incoming
                ? 'border border-dashed border-brand-300 bg-accent/50 text-accent-foreground'
                : 'bg-background text-muted-foreground',
            )}>
              {incoming ? (
                <Inbox className="size-3.5" aria-hidden />
              ) : (
                <CheckCircle2 className="size-3.5 text-positive-700" aria-hidden />
              )}
              {incoming ? 'Incoming request…' : 'You’re all caught up'}
            </div>
          ) : (
            <Land show className="relative">
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
                  <span id="flow-assign-chip" className="inline-flex shrink-0 items-center rounded-pill bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground shadow-soft-sm">
                    Assign
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1" style={{ perspective: 300 }}>
                    <Avatar className="size-4 text-[7px]"><AvatarFallback>MR</AvatarFallback></Avatar>
                    <FlipPill flipKey={pillKey}>
                      <StatusPill
                        status={completed ? 'completed' : started ? 'in_progress' : 'scheduled'}
                        label={completed ? 'Completed' : started ? 'In progress' : 'Confirmed'}
                        className="px-2 py-0.5 text-[9px]"
                      />
                    </FlipPill>
                  </span>
                )}
              </div>
              <AnimatePresence>
                {cue >= CUE_INDEX.pickerOpen && !assigned ? (
                  <m.div
                    initial={{ opacity: 0, y: 4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="absolute right-0 top-full z-20 mt-1 w-36 rounded-control border border-border bg-card p-1 shadow-soft-lg"
                  >
                    <div id="flow-maria-option" className={cn('flex items-center gap-1.5 rounded-chip px-2 py-1.5 text-[10px] font-semibold text-foreground transition-colors duration-base', cue >= CUE_INDEX.pickMaria && 'bg-accent text-accent-foreground')}>
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
            </Land>
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
                  <m.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE }} className="flex gap-2 px-1">
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
  const incoming = cue === CUE_INDEX.liftB
  const hasJob = cue >= CUE_INDEX.dropB
  const started = cue >= CUE_INDEX.started
  const complete = cue >= CUE_INDEX.panBack
  const photos = cue >= CUE_INDEX.photo3 ? 3 : cue >= CUE_INDEX.photo2 ? 2 : cue >= CUE_INDEX.photo1 ? 1 : 0
  const checks = cue >= CUE_INDEX.checkDone ? 8 : cue >= CUE_INDEX.check2 ? 5 : cue >= CUE_INDEX.check1 ? 3 : 2

  return (
    <div className="grid grid-cols-1 content-start gap-2 text-left">
      {!started ? (
        <>
          <p className="text-[13px] font-bold text-foreground">Your Thursday</p>
          <div className="flex items-center gap-2 rounded-control border border-border bg-card px-2.5 py-2 text-[11px]">
            <span className="w-8 shrink-0 text-center font-extrabold text-foreground tnum">8:00</span>
            <span className="h-6 w-px bg-border" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">Chen</span>
            <StatusPill status="completed" label="Done" className="px-2 py-0.5 text-[9px]" />
          </div>
          {incoming ? (
            <div className="rounded-control border border-dashed border-brand-300 bg-accent/50 px-2.5 py-3 text-center text-[10px] font-medium text-accent-foreground">
              New job incoming&hellip;
            </div>
          ) : null}
          <Land show={hasJob}>
            <div id="flow-job-row" className="flex items-center gap-2 rounded-control border border-brand-200 bg-accent px-2.5 py-2 text-[11px]">
              <span className="w-8 shrink-0 text-center font-extrabold text-foreground tnum">9:00</span>
              <span className="h-6 w-px bg-brand-200" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-foreground">Sarah K.</span>
                <span className="block text-[9px] text-muted-foreground">8 Cedar Ct</span>
              </span>
              <Badge className="px-1.5 py-0.5 text-[9px]">New</Badge>
            </div>
          </Land>
          {hasJob ? (
            <Pop show delay={0.45}>
              <div className="relative">
                <TapRipple fire={cue === CUE_INDEX.started} />
                <Button size="sm" className="h-8 w-full text-xs" tabIndex={-1}>Start job · directions</Button>
              </div>
            </Pop>
          ) : null}
        </>
      ) : (
        <Pop show className="grid grid-cols-1 gap-2">
          <div className="rounded-card bg-brand-600 p-3 text-primary-foreground shadow-soft-md">
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-brand-100">Active job</p>
            <p className="mt-0.5 text-sm font-extrabold">8 Cedar Ct</p>
            <p className="text-[10px] text-brand-100">Deep clean · Sarah K.</p>
          </div>

          <div className="rounded-control border border-border bg-card px-2.5 py-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-semibold text-foreground"><Camera className="size-3.5 text-muted-foreground" aria-hidden />Photos</span>
              <span className="text-[10px] text-muted-foreground tnum">{photos > 0 ? `${photos} added` : 'before + after'}</span>
            </div>
            <div className="mt-1.5 flex gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className="grid size-7 place-items-center overflow-hidden rounded-chip bg-secondary">
                  <AnimatePresence>
                    {photos > i ? (
                      <m.span
                        initial={{ scale: 0.3, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                        className="grid size-full place-items-center bg-accent"
                      >
                        <Camera className="size-3.5 text-accent-foreground" />
                      </m.span>
                    ) : null}
                  </AnimatePresence>
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-control border border-border bg-card px-2.5 py-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-semibold text-foreground"><ListChecks className="size-3.5 text-muted-foreground" aria-hidden />Checklist</span>
              {cue >= CUE_INDEX.checkDone ? (
                <Badge variant="positive" className="px-1.5 py-0.5 text-[9px]">8 of 8 done</Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground tnum">{checks} of 8</span>
              )}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-pill bg-secondary" aria-hidden>
              <m.div
                className="h-full rounded-pill bg-primary"
                animate={{ width: `${(checks / 8) * 100}%` }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </div>
          </div>

          {!complete ? (
            <m.div
              className="relative"
              animate={{ scale: cue === CUE_INDEX.completePress ? 0.93 : 1 }}
              transition={{ duration: 0.18 }}
            >
              <TapRipple fire={cue === CUE_INDEX.completePress} />
              <Button size="sm" className="h-8 w-full text-xs" disabled={cue < CUE_INDEX.checkDone} tabIndex={-1}>
                Complete job
              </Button>
            </m.div>
          ) : (
            <Land show>
              <div className="flex h-8 items-center justify-center gap-1.5 rounded-pill bg-positive-50 text-xs font-bold text-positive-700">
                <CheckCircle2 className="size-4" aria-hidden />
                Job complete
              </div>
            </Land>
          )}

        </Pop>
      )}
    </div>
  )
}

// --- stage layers -------------------------------------------------------------

function TravelLayer({ cue }: { cue: number }) {
  const lifting = cue >= CUE_INDEX.lift
  return (
    <AnimatePresence>
      {cue >= CUE_INDEX.collapse && cue < CUE_INDEX.drop ? (
        // One persistent card: it condenses out of the form over the phone,
        // holds its emphasis beat, then glides the path. No handoff, no
        // flicker.
        <m.div
          key="appt-travel"
          className="absolute z-30"
          style={{ offsetPath: `path("${PATH_A}")`, offsetRotate: '0deg' }}
          initial={{ offsetDistance: '0%', opacity: 0, scale: 0.65, y: 22 }}
          animate={
            lifting
              ? { offsetDistance: '100%', opacity: 1, scale: 1.02, y: 0 }
              : { offsetDistance: '0%', opacity: 1, scale: [0.65, 1.12, 1.05], y: 0 }
          }
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={
            lifting
              ? {
                  offsetDistance: { duration: FLIGHT_A_MS / 1000, ease: GLIDE },
                  scale: { duration: FLIGHT_A_MS / 1000, ease: 'easeInOut' },
                }
              : { duration: 0.65, ease: EASE, scale: { duration: 0.65, times: [0, 0.65, 1] } }
          }
          aria-hidden
        >
          <ApptCard />
        </m.div>
      ) : null}
      {cue === CUE_INDEX.liftB ? (
        <GlideAlong key="b" path={PATH_B} duration={FLIGHT_B_MS / 1000}>
          <div className="flex items-center gap-1.5 rounded-pill border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground shadow-soft-lg">
            <Avatar className="size-4 text-[7px]"><AvatarFallback>MR</AvatarFallback></Avatar>
            Thu 9:00 · Sarah K.
          </div>
        </GlideAlong>
      ) : null}

    </AnimatePresence>
  )
}

interface Pt { x: number; y: number }

/** Measure an element's center in stage coordinates (the stage is uniformly
 *  scaled, so dividing by the rendered scale undoes the camera transform). */
function stageCenter(id: string, stageEl: HTMLElement | null): Pt | null {
  const el = document.getElementById(id)
  if (!el || !stageEl) return null
  const er = el.getBoundingClientRect()
  const sr = stageEl.getBoundingClientRect()
  if (sr.width === 0) return null
  const sc = sr.width / STAGE_W
  return { x: (er.left + er.width / 2 - sr.left) / sc, y: (er.top + er.height / 2 - sr.top) / sc }
}

function CursorLayer({ cue, targets }: { cue: number; targets: { assign: Pt; maria: Pt } }) {
  const visible = cue >= CUE_INDEX.cursorIn && cue < CUE_INDEX.liftB
  const target = cue >= CUE_INDEX.pickMaria ? targets.maria : targets.assign
  const clicking = cue === CUE_INDEX.pickerOpen || cue === CUE_INDEX.assigned
  return (
    <AnimatePresence>
      {visible ? (
        <m.div
          key="cursor"
          initial={{ x: DASH.x + 460, y: 400, opacity: 0 }}
          animate={{ x: target.x, y: target.y, opacity: 1, scale: clicking ? 0.82 : 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          transition={{ x: { type: 'spring', stiffness: 180, damping: 24 }, y: { type: 'spring', stiffness: 180, damping: 24 }, scale: { duration: 0.15 } }}
          className="absolute left-0 top-0 z-40"
          aria-hidden
        >
          <MousePointer2 className="size-5 fill-foreground stroke-background drop-shadow" />
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}

// --- the showcase --------------------------------------------------------------

export function FlowShowcase() {
  const reduced = useReducedMotion() ?? false
  const { cue, rootRef } = useFlowClock(reduced)
  const [containerW, setContainerW] = React.useState<number | null>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [cursorTargets, setCursorTargets] = React.useState<{ assign: Pt; maria: Pt }>({
    assign: { x: DASH.x + 340, y: 212 },
    maria: { x: DASH.x + 306, y: 256 },
  })

  // Aim the cursor at where the Assign chip and the Maria option actually
  // render (hardcoded coordinates drift as copy and layout evolve).
  React.useEffect(() => {
    if (reduced) return
    if (cue === CUE_INDEX.cursorIn) {
      const pt = stageCenter('flow-assign-chip', stageRef.current)
      if (pt) setCursorTargets((t) => ({ ...t, assign: pt }))
    } else if (cue === CUE_INDEX.pickMaria) {
      const pt = stageCenter('flow-maria-option', stageRef.current)
      if (pt) setCursorTargets((t) => ({ ...t, maria: pt }))
    }
  }, [cue, reduced])

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
        aria-hidden
      >
        <m.div
          ref={stageRef}
          className="absolute left-0 top-0"
          style={{ width: STAGE_W, height: STAGE_H, transformOrigin: '0 0' }}
          animate={{ x: camX, scale }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 55, damping: 20 }}
        >
          <StageLabels />
          <div className="absolute z-10" style={{ left: HOME.x, top: HOME.y, width: HOME.w, height: HOME.h }}>
            <PhoneFrame initials="SK" tabs={HOMEOWNER_TABS} className="h-full w-full">
              <HomeownerSurface cue={cue} />
            </PhoneFrame>
          </div>
          <div className="absolute z-10" style={{ left: DASH.x, top: DASH.y, width: DASH.w }}>
            <BrowserFrame label="app.nexxus.com" appBar>
              <OperatorSurface cue={cue} />
            </BrowserFrame>
          </div>
          <div className="absolute z-10" style={{ left: CLEAN.x, top: CLEAN.y, width: CLEAN.w, height: CLEAN.h }}>
            <PhoneFrame initials="MR" tabs={CLEANER_TABS} className="h-full w-full">
              <CleanerSurface cue={cue} />
            </PhoneFrame>
          </div>
          {!reduced ? (
            <>
              <TravelLayer cue={cue} />
              <CursorLayer cue={cue} targets={cursorTargets} />
            </>
          ) : null}
        </m.div>
      </div>

      <p className="mx-auto mt-6 min-h-10 max-w-md text-center text-sm font-medium text-muted-foreground" aria-live="polite">
        {caption}
      </p>
    </div>
  )
}
