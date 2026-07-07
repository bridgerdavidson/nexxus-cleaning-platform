'use client'

import * as React from 'react'
import { motion as m, useReducedMotion } from 'motion/react'
import { Camera, CheckCircle2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { PhoneFrame } from './frames'

// Mirrors the real homeowner "Cleaning in progress" hero (brand gradient,
// white text, before-photo thumbnails). The live stage label carries the
// story; no progress bar. No stepper dots.
const STAGES = ['Getting started', 'Before photos', 'Cleaning the kitchen', 'Wrapping up', 'Complete'] as const
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

        <div ref={ref} className="flex justify-center">
          <PhoneFrame className="w-72">
            <div className="grid grid-cols-1 gap-3 text-left">
              <Badge variant="secondary" className="justify-self-start px-2 py-0.5 text-[10px]">Sarah · customer</Badge>

              {/* the real homeowner hero card: brand gradient, white text */}
              <div className="rounded-card bg-gradient-to-br from-brand-600 to-brand-500 p-4 text-white shadow-soft-md">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/80">
                  {complete ? 'Cleaning complete' : 'Cleaning in progress'}
                </p>
                <p className="mt-1 text-lg font-extrabold tnum">Thu · 9:00 AM</p>
                <p className="text-[11px] text-white/85">8 Cedar Ct · Deep clean</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <Avatar className="size-6 text-[9px]"><AvatarFallback className="bg-white/25 text-white">MR</AvatarFallback></Avatar>
                  <span className="text-[11px] font-semibold">Maria R.</span>
                  <span className="ml-auto text-[10px] font-semibold text-white/75">Your cleaner</span>
                </div>

                {/* the live stage carries the story now, not a bar */}
                <div className="mt-3 border-t border-white/20 pt-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/70">
                      {complete ? 'Finished' : 'Right now'}
                    </p>
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-white/85">
                      {!complete ? (
                        <span className="relative inline-flex size-2" aria-hidden>
                          <span className="absolute inline-flex size-full animate-ping rounded-pill bg-white opacity-70" />
                          <span className="relative inline-flex size-2 rounded-pill bg-white" />
                        </span>
                      ) : null}
                      <span className="tabular-nums">{ELAPSED[i]} elapsed</span>
                    </span>
                  </div>
                  <p className="mt-1 min-h-7 text-lg font-extrabold leading-tight" aria-live="polite">
                    {STAGES[i]}
                  </p>

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

              {complete ? (
                <Badge variant="positive" className="justify-center py-1.5">
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  All done. Photos are in your inbox.
                </Badge>
              ) : null}
            </div>
          </PhoneFrame>
        </div>
      </div>
    </section>
  )
}
