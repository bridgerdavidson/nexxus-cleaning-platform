'use client'

import * as React from 'react'
import { motion as m, useReducedMotion } from 'motion/react'
import { Bell, Camera, CheckCircle2, MapPin, Sparkles } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { PhoneFrame } from './frames'

const EASE = [0.22, 1, 0.36, 1] as const

// The homeowner's live view: as the crew works, the stage advances, the
// checklist bar fills, and time ticks. Mirrors LiveCleaningProgress.
const STAGES = ['Arrived', 'Before photos', 'Cleaning', 'After photos', 'Complete'] as const
// tasks done at each stage index (of 14)
const TASKS = [0, 2, 9, 14, 14]
const ELAPSED = ['0m', '6m', '38m', '52m', '54m']

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
        if (e.isIntersecting && !timer) {
          timer = setInterval(() => setI((v) => (v + 1) % len), ms)
        } else if (!e.isIntersecting && timer) {
          clearInterval(timer)
          timer = undefined
        }
      },
      { threshold: 0.4 },
    )
    io.observe(node)
    return () => {
      io.disconnect()
      if (timer) clearInterval(timer)
    }
  }, [len, ms, reduced])
  return { i, ref }
}

export function LiveTrackingSection() {
  const reduced = useReducedMotion() ?? false
  const { i, ref } = useTicker(STAGES.length, 2600, reduced)
  const done = TASKS[i]
  const pct = Math.round((done / 14) * 100)
  const complete = i === STAGES.length - 1

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="text-center lg:text-left">
          <Badge variant="secondary">Your customers stay in the loop</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            They watch the clean happen, live
          </h2>
          <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">
            No more &ldquo;are they done yet?&rdquo; texts. Your customer sees the crew arrive,
            watches the checklist tick off room by room, and gets the after photos the moment the
            job wraps. It makes a two-person operation look like a national brand.
          </p>
          <ul className="mx-auto mt-6 grid max-w-sm gap-3 text-left lg:mx-0">
            {[
              'Live stage: arrived, cleaning, wrapping up',
              'A checklist bar that fills as work gets done',
              'Before and after photos, sent automatically',
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
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">Sarah · customer</Badge>
                <Bell className="size-4 text-muted-foreground" aria-hidden />
              </div>

              <div className={cn(
                'rounded-card p-3.5 text-primary-foreground shadow-soft-md transition-colors',
                'bg-gradient-to-br from-brand-600 to-brand-500',
              )}>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-brand-100">
                  {complete ? 'Cleaning complete' : 'Cleaning in progress'}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-lg font-extrabold">8 Cedar Ct</p>
                  <span className="rounded-pill bg-card/20 px-2 py-0.5 text-[11px] font-bold tnum">{ELAPSED[i]}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Avatar className="size-5 text-[8px]"><AvatarFallback className="bg-card/25 text-primary-foreground">MR</AvatarFallback></Avatar>
                  <span className="text-[11px] font-semibold">Maria R.</span>
                  {!complete ? (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-brand-100">
                      <MapPin className="size-3" aria-hidden />on site
                    </span>
                  ) : (
                    <CheckCircle2 className="ml-auto size-4" aria-hidden />
                  )}
                </div>
              </div>

              {/* stage stepper */}
              <div className="flex items-center justify-between px-0.5">
                {STAGES.map((s, idx) => (
                  <React.Fragment key={s}>
                    <div className="flex flex-col items-center gap-1">
                      <m.span
                        animate={{
                          backgroundColor: idx <= i ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                          scale: idx === i ? [1, 1.35, 1] : 1,
                        }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="size-2.5 rounded-pill"
                        aria-hidden
                      />
                    </div>
                    {idx < STAGES.length - 1 ? (
                      <div className="mx-1 h-px flex-1 bg-border" aria-hidden />
                    ) : null}
                  </React.Fragment>
                ))}
              </div>
              <p className="text-center text-[11px] font-semibold text-foreground" aria-live="polite">{STAGES[i]}</p>

              {/* checklist progress */}
              <div className="rounded-control border border-border bg-card px-3 py-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-foreground">Checklist</span>
                  <span className="text-muted-foreground tnum">{done} of 14 done</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-secondary" aria-hidden>
                  <m.div
                    className="h-full rounded-pill bg-primary"
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: EASE }}
                  />
                </div>
              </div>

              {/* photo peek */}
              <div className="grid grid-cols-3 gap-1.5" aria-hidden>
                {[0, 1, 2].map((idx) => {
                  const shown = i >= (idx === 0 ? 1 : idx === 1 ? 3 : 3) && (idx < 2 || complete)
                  return (
                    <span key={idx} className="grid h-14 place-items-center overflow-hidden rounded-chip bg-secondary">
                      {shown ? (
                        <m.span
                          initial={{ scale: 0.4, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                          className="grid size-full place-items-center bg-accent"
                        >
                          <Camera className="size-4 text-accent-foreground" />
                        </m.span>
                      ) : null}
                    </span>
                  )
                })}
              </div>

              {complete ? (
                <Badge variant="positive" className="justify-center py-1.5">
                  <Sparkles className="size-3.5" aria-hidden />
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
