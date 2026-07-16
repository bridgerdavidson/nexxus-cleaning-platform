'use client'

import * as React from 'react'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { Camera, CheckCircle2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const

// Mirrors the real homeowner LiveCleaningProgress: everything lives inside the
// brand gradient "Cleaning in progress" hero (white text, white progress bar,
// before-photo thumbnails). No stepper dots.
const STAGES = ['Getting started', 'Before photos', 'Cleaning', 'Wrapping up', 'Complete'] as const
const TASKS = [0, 2, 9, 14, 14]
const ELAPSED = ['2m', '9m', '38m', '52m', '54m']

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
          <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">
            No more &ldquo;are they done yet?&rdquo; texts. Your customer sees the crew arrive,
            watches the checklist tick off room by room, and gets the before photos the moment work
            starts. Your admins and managers see the exact same live progress from their dashboard,
            so everyone knows where a job is at and what is getting done. It makes a two-person
            operation look like a national brand.
          </p>
          <ul className="mx-auto mt-6 grid max-w-sm gap-3 text-left lg:mx-0">
            {[
              'A live status, right on their home screen',
              'A checklist bar that fills as work gets done',
              'Before and after photos, sent automatically',
              'The same live view for your admins and managers, from any dashboard',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive-700" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div ref={ref} className="flex flex-col items-center">
          {/* No phone shell here on purpose. The hero already establishes that
              this is the customer's phone; repeating the chrome around one card
              just crowds it. The gradient card is the whole point of the
              section, so it stands alone. */}
          <div className="w-full max-w-[340px] text-left">
              {/* the real homeowner hero card: brand gradient, white text */}
              <div className="rounded-card bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white shadow-soft-lg">
                {/* This switch is the payoff of the whole section, so it carries
                    the emphasis itself rather than handing it to a badge that
                    appears below the card and shoves the card up. Fixed height
                    plus an AnimatePresence swap keyed on the state: the line
                    changes in place and nothing below it moves. */}
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
        </div>
      </div>
    </section>
  )
}
