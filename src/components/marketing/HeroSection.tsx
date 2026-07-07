'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { BrowserFrame, MiniRail, PhoneFrame } from './frames'

const EASE = [0.16, 1, 0.3, 1] as const

// One booking travels through the company: it appears on the homeowner's
// phone, lands in the operator inbox, gets assigned, then the money arrives.
const BEATS = [
  'Sarah books a deep clean from her phone. Her card is saved automatically.',
  'The job lands in your inbox. No phone tag, no sticky notes.',
  'One tap assigns Maria. She gets the job on her phone instantly.',
  'Job done. The card is charged and the payout is on its way.',
]

function useHeroLoop() {
  const reduced = useReducedMotion()
  const [phase, setPhase] = React.useState(reduced ? 3 : 0)
  const [paused, setPaused] = React.useState(false)
  React.useEffect(() => {
    if (reduced || paused) return
    const id = setInterval(() => setPhase((p) => (p + 1) % 4), 3200)
    return () => clearInterval(id)
  }, [reduced, paused])
  const jumpTo = (p: number) => {
    setPhase(p)
    setPaused(true)
  }
  return { phase, jumpTo, setPaused, reduced }
}

function Enter({ show, children, delay = 0 }: { show: boolean; children: React.ReactNode; delay?: number }) {
  return (
    <AnimatePresence>
      {show ? (
        <m.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: EASE, delay }}
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}

function HomeownerScreen({ phase }: { phase: number }) {
  return (
    <div className="grid grid-cols-1 gap-2 text-left">
      <Badge variant="secondary" className="justify-self-start">Customer view</Badge>
      <p className="text-sm font-bold text-foreground">Book your cleaning</p>
      <div className="flex items-center justify-between gap-2 rounded-control border border-border bg-card p-2.5 text-xs">
        <span className="text-muted-foreground">Deep clean · 3 bd 2 ba</span>
        <span className="font-bold text-foreground tnum">$180</span>
      </div>
      <div className="rounded-control border border-border bg-card p-2.5 text-xs text-muted-foreground">Thursday · 9:00 AM</div>
      <Enter show={phase >= 0}>
        <div className="grid gap-2">
          <Button size="sm" className="w-full" tabIndex={-1}>Booked</Button>
          <p className="text-[11px] text-muted-foreground">Card saved. Confirmation sent.</p>
        </div>
      </Enter>
      <Enter show={phase >= 3}>
        <Badge variant="positive" className="justify-self-start">Payment received · $180</Badge>
      </Enter>
    </div>
  )
}

function CleanerScreen({ phase }: { phase: number }) {
  return (
    <div className="grid grid-cols-1 gap-2 text-left">
      <Badge variant="secondary" className="justify-self-start">Cleaner view</Badge>
      <p className="text-sm font-bold text-foreground">Your Thursday</p>
      <div className="flex items-center justify-between rounded-control border border-border bg-card p-2.5 text-xs">
        <span className="font-semibold text-foreground">8:00 · Chen family</span>
        <StatusPill status="completed" label="Done" className="px-2 py-0.5 text-[10px]" />
      </div>
      <Enter show={phase >= 2}>
        <div className="flex items-center justify-between rounded-control border border-brand-200 bg-accent p-2.5 text-xs">
          <span className="font-semibold text-foreground">9:00 · Sarah K.</span>
          <span className="font-semibold text-accent-foreground">New</span>
        </div>
      </Enter>
      <Button size="sm" variant="outline" className="w-full" tabIndex={-1}>Directions</Button>
    </div>
  )
}

function OperatorScreen({ phase }: { phase: number }) {
  const needsYou = phase >= 2 ? 0 : phase >= 1 ? 1 : 0
  const revenue = phase >= 3 ? 1420 : 1240
  return (
    <div className="flex">
      <MiniRail />
      <div className="flex-1 bg-background p-3.5 text-left sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-foreground">Good morning, Dana</p>
          <Badge className="hidden sm:inline-flex">Thursday</Badge>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-control border border-border bg-card p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Jobs today</p>
            <p className="text-lg font-extrabold text-foreground tnum">8</p>
          </div>
          <div className="rounded-control border border-border bg-card p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Needs you</p>
            <p className="text-lg font-extrabold text-foreground tnum">
              <AnimatedNumber value={needsYou} />
            </p>
          </div>
          <div className="rounded-control border border-border bg-card p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Revenue</p>
            <p className="text-lg font-extrabold text-foreground tnum">
              <AnimatedNumber value={revenue} prefix="$" />
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs">
          <div className="flex items-center justify-between rounded-control border border-border bg-card p-2.5">
            <span className="font-semibold text-foreground">Maria R. · 114 Birch Ln</span>
            <StatusPill status="in_progress" className="px-2 py-0.5 text-[10px]" />
          </div>
          <Enter show={phase >= 1}>
            <div className="flex items-center justify-between rounded-control border border-border bg-card p-2.5">
              <span className="font-semibold text-foreground">New · Sarah K. · Thu 9:00</span>
              {phase >= 2 ? (
                <StatusPill status="scheduled" label="Maria R." className="px-2 py-0.5 text-[10px]" />
              ) : (
                <StatusPill status="pending" label="Needs you" className="px-2 py-0.5 text-[10px]" />
              )}
            </div>
          </Enter>
          <div className="flex items-center justify-between rounded-control border border-border bg-card p-2.5">
            <span className="font-semibold text-foreground">James T. · 22 Harbor View</span>
            <StatusPill status="scheduled" label="1:30 PM" className="px-2 py-0.5 text-[10px]" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Which single screen carries each beat on small viewports.
const MOBILE_SCREEN: Array<'customer' | 'owner' | 'cleaner'> = ['customer', 'owner', 'cleaner', 'owner']

function HeroTriptych() {
  const { phase, jumpTo, setPaused, reduced } = useHeroLoop()
  const mobileScreen = MOBILE_SCREEN[phase]
  return (
    <div
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className="relative"
    >
      {/* Desktop: all three surfaces on stage at once. */}
      <div className="hidden lg:flex lg:items-stretch lg:justify-center lg:gap-6">
        <PhoneFrame className="w-56 shrink-0 self-center lg:-rotate-2">
          <CleanerScreen phase={phase} />
        </PhoneFrame>
        <BrowserFrame label="app.nexxus · demo data" className="w-full max-w-xl lg:z-10">
          <OperatorScreen phase={phase} />
        </BrowserFrame>
        <PhoneFrame className="w-56 shrink-0 self-center lg:rotate-2">
          <HomeownerScreen phase={phase} />
        </PhoneFrame>
      </div>
      {/* Mobile: one legible screen at a time, synced to the beat. */}
      <div className="flex min-h-[380px] items-center justify-center lg:hidden">
        <AnimatePresence mode="wait">
          <m.div
            key={mobileScreen}
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex w-full justify-center"
          >
            {mobileScreen === 'owner' ? (
              <BrowserFrame label="app.nexxus · demo data" className="w-full max-w-xl">
                <OperatorScreen phase={phase} />
              </BrowserFrame>
            ) : mobileScreen === 'cleaner' ? (
              <PhoneFrame className="w-full max-w-[290px]">
                <CleanerScreen phase={phase} />
              </PhoneFrame>
            ) : (
              <PhoneFrame className="w-full max-w-[290px]">
                <HomeownerScreen phase={phase} />
              </PhoneFrame>
            )}
          </m.div>
        </AnimatePresence>
      </div>
      <div className="mt-6 flex flex-col items-center gap-2" aria-live="polite">
        <div className="flex items-center gap-2">
          {BEATS.map((beat, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jumpTo(i)}
              aria-label={`Step ${i + 1}: ${beat}`}
              aria-current={i === phase || undefined}
              className="grid h-6 place-items-center px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-pill"
            >
              <span
                className={
                  i === phase
                    ? 'h-1.5 w-6 rounded-pill bg-primary transition-all duration-slow'
                    : 'h-1.5 w-1.5 rounded-pill bg-warm-300 transition-all duration-slow'
                }
              />
            </button>
          ))}
        </div>
        <p className="min-h-10 max-w-md text-center text-sm font-medium text-muted-foreground">
          {reduced ? 'One booking, handled end to end. From booked to paid without a single phone call.' : BEATS[phase]}
        </p>
      </div>
    </div>
  )
}

export function HeroSection() {
  return (
    <section id="top" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-3xl text-center">
        <m.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <Badge className="mb-5">
            <Sparkles />
            Early access · Built for cleaning companies
          </Badge>
          <h1 className="text-4xl font-extrabold leading-[1.06] tracking-tight text-foreground sm:text-6xl">
            Run your cleaning company from one calm screen.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg font-medium leading-relaxed text-muted-foreground">
            Bookings, crews, and payments in one place. Your office, your cleaners, and your
            customers finally see the same day.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <a href="#waitlist">Join the waitlist</a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
        </m.div>
      </div>
      <m.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
        className="mt-12 sm:mt-16"
      >
        <HeroTriptych />
      </m.div>
    </section>
  )
}
