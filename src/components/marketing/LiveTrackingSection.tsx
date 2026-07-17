'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { Camera, CheckCircle2, Monitor, Smartphone } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { StatusPill } from '@/components/ui/status-pill'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const

// Mirrors the real homeowner LiveCleaningProgress: everything lives inside the
// brand gradient "Cleaning in progress" hero (white text, white progress bar,
// before-photo thumbnails). No stepper dots.
const STAGES = ['Getting started', 'Before photos', 'Cleaning', 'Wrapping up', 'Complete'] as const
const TASKS = [0, 2, 9, 14, 14]
const ELAPSED = ['2m', '9m', '38m', '52m', '54m']

// Three benefits, mapped to what the customer card above shows (status line,
// progress bar, photo row). The fourth point (the office sees it too) is now
// shown by the second surface, not told in a bullet.
const BENEFITS = [
  'A live status, right on their home screen',
  'A checklist bar that fills as work gets done',
  'Before and after photos, sent automatically',
]

function useTicker(len: number, ms: number, reduced: boolean) {
  const [i, setI] = React.useState(reduced ? len - 1 : 0)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (reduced) return
    const node = ref.current
    if (!node) return
    let timer: ReturnType<typeof setInterval> | undefined
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !timer) timer = setInterval(() => setI((v) => (v + 1) % len), ms)
        else if (!e.isIntersecting && timer) { clearInterval(timer); timer = undefined }
      },
      { threshold: 0.4 },
    )
    io.observe(node)
    return () => { io.disconnect(); if (timer) clearInterval(timer) }
  }, [len, ms, reduced])
  return { i, ref }
}

/** Page-voice label above each surface: says whose view this is, in one style
 *  for both, so the pair reads as "same job, two viewers" (the hero uses the
 *  same label-above-frame idea). */
function ViewLabel({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <p className="mb-2.5 flex items-center gap-2 pl-0.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </p>
  )
}

export function LiveTrackingSection() {
  const reduced = useReducedMotion() ?? false
  const { i, ref } = useTicker(STAGES.length, 2600, reduced)
  const done = TASKS[i]
  const pct = Math.round((done / 14) * 100)
  const complete = i === STAGES.length - 1
  const photosShown = i >= 3 ? 3 : i >= 1 ? Math.min(i, 2) : 0

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="text-center lg:text-left">
          <Badge variant="secondary">Everyone stays in the loop</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            They watch the clean happen, live
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base font-medium leading-relaxed text-muted-foreground lg:mx-0">
            No more &ldquo;are they done yet?&rdquo; texts. The customer and your office see the same
            clean, live.
          </p>
          <ul className="mx-auto mt-6 grid max-w-sm gap-3 text-left lg:mx-0">
            {BENEFITS.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive-700" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Two labeled views of one job. The customer's live card and the office's
            dashboard row are the same width, stacked and aligned (no floating
            offset), each captioned with whose view it is, and both driven by the
            same ticker so the data always matches. That is the "everyone stays in
            the loop" promise, shown. */}
        <div ref={ref} className="mx-auto flex w-full max-w-[380px] flex-col gap-5">
          <div>
            <ViewLabel icon={Smartphone}>The customer</ViewLabel>
            {/* the real homeowner hero card: brand gradient, white text */}
            <div className="rounded-card bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white shadow-soft-lg">
              {/* Fixed-height status line that swaps in place (nothing below moves). */}
              <div className="flex h-4 items-center">
                <AnimatePresence mode="wait" initial={false}>
                  <m.span
                    key={complete ? 'done' : 'live'}
                    initial={reduced ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    transition={{ duration: 0.26, ease: EASE }}
                    className={cn(
                      'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em]',
                      complete ? 'text-white' : 'text-white/80',
                    )}
                  >
                    {complete ? <CheckCircle2 className="size-3.5 flex-none" aria-hidden /> : null}
                    {complete ? 'Cleaning complete' : 'Cleaning in progress'}
                  </m.span>
                </AnimatePresence>
              </div>
              <p className="mt-1 text-lg font-extrabold tnum">Thu · 9:00 AM</p>
              <p className="text-[11px] text-white/85">8 Cedar Ct · Deep clean</p>
              <div className="mt-2.5 flex items-center gap-2">
                <Avatar className="size-6 text-[9px]"><AvatarFallback className="bg-white/25 text-white">MR</AvatarFallback></Avatar>
                <span className="text-[11px] font-semibold">Maria R.</span>
                <span className="ml-auto text-[10px] font-semibold text-white/75">Your cleaner</span>
              </div>

              {/* LiveCleaningProgress, mirrored */}
              <div className="mt-3 border-t border-white/20 pt-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span aria-live="polite">{STAGES[i]}</span>
                  <span className="tabular-nums text-white/85">{ELAPSED[i]}</span>
                </div>
                <Progress
                  value={pct}
                  aria-label={`${done} of 14 tasks done`}
                  className="mt-2 bg-white/25"
                  barClassName="bg-white"
                />
                <p className="mt-1 text-[11px] tabular-nums text-white/85">{done} of 14 tasks done</p>

                <div className="mt-3 flex gap-2" aria-hidden>
                  {[0, 1, 2].map((idx) => (
                    <span key={idx} className="grid size-14 flex-none place-items-center overflow-hidden rounded-control bg-white/15">
                      {photosShown > idx ? (
                        <m.span
                          initial={reduced ? false : { scale: 0.4, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                          className="grid size-full place-items-center bg-white/25"
                        >
                          <Camera className="size-4 text-white" />
                        </m.span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div>
            <ViewLabel icon={Monitor}>The office</ViewLabel>
            {/* The office watches the exact same job, live, from the dashboard. A
                compact confirmation row: same job, same live data as the card
                above. Decorative mirror, so aria-hidden to avoid a duplicate live
                region. */}
            <Card aria-hidden className="p-4">
              <div className="flex items-center gap-2.5">
                <Avatar className="size-7 text-[10px]"><AvatarFallback>MR</AvatarFallback></Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-foreground">8 Cedar Ct</span>
                  <span className="block truncate text-xs text-muted-foreground">Maria R. · {STAGES[i]}</span>
                </span>
                <StatusPill
                  status={complete ? 'completed' : 'in_progress'}
                  className="shrink-0 px-2.5 py-0.5 text-[11px]"
                />
              </div>
              <div className="mt-3 flex items-center gap-2.5">
                <Progress value={pct} className="flex-1" />
                <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{done}/14</span>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  )
}
