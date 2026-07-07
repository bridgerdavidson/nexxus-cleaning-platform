'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { Camera, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { BrowserFrame, PhoneFrame } from './frames'

const EASE = [0.16, 1, 0.3, 1] as const

const STEPS = [
  {
    pill: 'Sarah books online',
    title: 'A booking arrives while you sleep',
    caption:
      'Sarah picks a time on your booking page at 9 PM. Her card is saved, the visit lands on your calendar, and nobody called anybody.',
  },
  {
    pill: 'Maria gets her day',
    title: 'Your cleaner opens her phone, not a group chat',
    caption:
      'Maria sees her jobs, addresses, and directions in one tap. No printed schedules, no morning texts.',
  },
  {
    pill: 'Job done, photos in',
    title: 'Proof of work, without asking for it',
    caption:
      'Maria marks the job complete and attaches photos. Sarah gets the good news automatically.',
  },
  {
    pill: 'Money lands',
    title: 'The card charges itself',
    caption:
      'The saved card is charged when the job is completed. Your cut and Maria’s payout are split automatically.',
  },
]

function StepVignette({ step }: { step: number }) {
  if (step === 0) {
    return (
      <BrowserFrame label="book.brightside.com · your branded booking page" className="w-full max-w-md">
        <div className="grid gap-2.5 bg-background p-5 text-left">
          <p className="text-sm font-bold text-foreground">Book your cleaning</p>
          <div className="flex items-center justify-between rounded-control border border-border bg-card p-3 text-xs">
            <span className="font-semibold text-foreground">Deep clean · 3 bd 2 ba</span>
            <span className="font-bold text-foreground tnum">$180</span>
          </div>
          <div className="flex items-center justify-between rounded-control border border-border bg-card p-3 text-xs">
            <span className="font-semibold text-foreground">Thursday · 9:00 AM</span>
            <Badge variant="positive" className="px-2 py-0.5 text-[10px]">Available</Badge>
          </div>
          <Button size="sm" className="w-full" tabIndex={-1}>Confirm booking</Button>
          <p className="text-[11px] text-muted-foreground">Card saved for later. Nothing is charged today.</p>
        </div>
      </BrowserFrame>
    )
  }
  if (step === 1) {
    return (
      <PhoneFrame className="w-64">
        <div className="grid gap-2 text-left">
          <p className="text-sm font-bold text-foreground">Your Thursday · 3 jobs</p>
          <div className="rounded-control border border-brand-200 bg-accent p-3 text-xs">
            <p className="font-semibold text-foreground">9:00 · Sarah K. · Deep clean</p>
            <p className="mt-1 text-muted-foreground">8 Cedar Ct · gate code 4412</p>
          </div>
          <div className="flex items-center justify-between rounded-control border border-border bg-card p-3 text-xs">
            <span className="font-semibold text-foreground">12:30 · Chen family</span>
            <StatusPill status="scheduled" className="px-2 py-0.5 text-[10px]" />
          </div>
          <Button size="sm" className="w-full" tabIndex={-1}>Start job · directions</Button>
        </div>
      </PhoneFrame>
    )
  }
  if (step === 2) {
    return (
      <PhoneFrame className="w-64">
        <div className="grid gap-2 text-left">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-foreground">Sarah K. · Deep clean</p>
            <StatusPill status="completed" className="px-2 py-0.5 text-[10px]" />
          </div>
          <div className="grid grid-cols-3 gap-1.5" aria-hidden>
            <span className="grid h-14 place-items-center rounded-chip bg-secondary"><Camera className="size-4 text-muted-foreground" /></span>
            <span className="grid h-14 place-items-center rounded-chip bg-secondary"><Camera className="size-4 text-muted-foreground" /></span>
            <span className="grid h-14 place-items-center rounded-chip bg-secondary"><Camera className="size-4 text-muted-foreground" /></span>
          </div>
          <p className="text-[11px] text-muted-foreground">3 photos attached</p>
          <Badge variant="positive" className="justify-self-start"><CheckCircle2 />Sarah has been notified</Badge>
        </div>
      </PhoneFrame>
    )
  }
  return (
    <BrowserFrame label="app.nexxus · payments" className="w-full max-w-md">
      <div className="grid gap-2.5 bg-background p-5 text-left">
        <div className="flex items-center justify-between rounded-control border border-border bg-card p-3 text-xs">
          <span className="font-semibold text-foreground">Sarah K. · Deep clean</span>
          <Badge variant="positive" className="px-2 py-0.5 text-[10px]">Paid $180</Badge>
        </div>
        <div className="flex items-center justify-between rounded-control border border-border bg-card p-3 text-xs">
          <span className="font-semibold text-foreground">Maria’s payout</span>
          <Badge className="px-2 py-0.5 text-[10px]">On its way</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">No invoices to send. No checks to chase.</p>
      </div>
    </BrowserFrame>
  )
}

export function StorySection() {
  const reduced = useReducedMotion()
  const [active, setActive] = React.useState(0)
  const [interacted, setInteracted] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)

  // Gentle auto-advance while the stage is in view, until the visitor takes over.
  React.useEffect(() => {
    if (reduced || interacted) return
    const node = stageRef.current
    if (!node) return
    let timer: ReturnType<typeof setInterval> | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !timer) {
          timer = setInterval(() => setActive((s) => (s + 1) % STEPS.length), 4500)
        } else if (!entry.isIntersecting && timer) {
          clearInterval(timer)
          timer = undefined
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (timer) clearInterval(timer)
    }
  }, [reduced, interacted])

  const select = (i: number) => {
    setInteracted(true)
    setActive(i)
  }

  const step = STEPS[active]

  return (
    <section id="how-it-works" className="scroll-mt-16 border-y border-border bg-card">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary">How it works</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Follow one job from booked to paid
          </h2>
          <p className="mt-3 text-base font-medium text-muted-foreground">
            The whole hand-off, with nobody chasing anybody.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Story steps"
          className="mt-8 flex flex-wrap justify-center gap-2"
        >
          {STEPS.map((s, i) => (
            <button
              key={s.pill}
              role="tab"
              aria-selected={i === active}
              onClick={() => select(i)}
              className={
                i === active
                  ? 'inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft-sm transition-all duration-base ease-out-soft'
                  : 'inline-flex items-center gap-2 rounded-pill border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-base ease-out-soft hover:bg-muted'
              }
            >
              <span
                className={
                  i === active
                    ? 'grid size-5 place-items-center rounded-pill bg-primary-foreground/25 text-xs font-bold'
                    : 'grid size-5 place-items-center rounded-pill bg-secondary text-xs font-bold text-muted-foreground'
                }
                aria-hidden
              >
                {i + 1}
              </span>
              {s.pill}
            </button>
          ))}
        </div>

        <div ref={stageRef} className="mt-10 grid items-center gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="text-center lg:text-left">
            <AnimatePresence mode="wait">
              <m.div
                key={active}
                initial={reduced ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent-foreground">
                  Step {active + 1} of {STEPS.length}
                </p>
                <h3 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                  {step.title}
                </h3>
                <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">
                  {step.caption}
                </p>
              </m.div>
            </AnimatePresence>
          </div>
          <div className="flex min-h-[320px] items-center justify-center">
            <AnimatePresence mode="wait">
              <m.div
                key={active}
                initial={reduced ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex w-full justify-center"
              >
                <StepVignette step={active} />
              </m.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
