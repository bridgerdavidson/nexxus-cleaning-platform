'use client'

import * as React from 'react'
import { motion as m, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

// One motion language for the whole marketing page: content fades and rises as
// it scrolls into view, once. Same travel and easing the hero plays on load, so
// every section reads as the same gesture rather than each rolling its own. It
// animates transform/opacity only (no layout shift), and honors reduced-motion
// by rendering the final state with no animation.
//
// The trigger is a hand-rolled IntersectionObserver with a viewport-relative
// bottom inset, deliberately NOT motion's `whileInView`:
//   - motion's `viewport.margin` drops negative values in Safari, and a
//     negative bottom inset is exactly what "reveal a bit after it enters" needs.
//   - `viewport.amount` is element-height-relative, so a short section and a tall
//     section fire at different screen positions (short ones ended up revealing
//     way down near the bottom edge, before the eye reaches them).
// A px rootMargin computed from innerHeight fires every section at the same spot:
// when its top passes REVEAL_AT down the viewport, so the reader is looking right
// at it as it pops. Native IO negative-px rootMargin is well supported, Safari
// included.
const EASE = [0.16, 1, 0.3, 1] as const

// Fraction down the viewport the block's top must reach before it reveals.
// Higher = later (more centered). 0.55 puts it just below mid-screen.
const REVEAL_AT = 0.55

export function Reveal({
  children,
  className,
  y = 24,
}: {
  children: ReactNode
  className?: string
  y?: number
}) {
  const reduced = useReducedMotion() ?? false
  const ref = React.useRef<HTMLDivElement>(null)
  const [shown, setShown] = React.useState(false)

  React.useEffect(() => {
    if (reduced) return
    const node = ref.current
    if (!node) return
    // Shrink the observer root's bottom so the element only counts as "in view"
    // once its top has risen past REVEAL_AT of the viewport.
    const inset = Math.round(window.innerHeight * (1 - REVEAL_AT))
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: `0px 0px -${inset}px 0px` },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [reduced])

  const revealed = reduced || shown

  return (
    <m.div
      ref={ref}
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: reduced ? 0 : 0.5, ease: EASE }}
    >
      {children}
    </m.div>
  )
}
