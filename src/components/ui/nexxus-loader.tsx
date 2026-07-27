'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Animated Nexxus mark for loading states ("pipeline pulse").
 *
 * Motion: each stroke is revealed by a soft-edged band traveling along its own
 * axis. The two dark pipelines draw from the top-left; the two light dashes
 * share ONE band running bottom-left -> top-right, so they read as a single
 * continuous line passing behind the pipelines at the crossing. The first
 * cycle draws in from blank; its drain-out leaves a faint ghost of the full
 * mark behind (fill="freeze"), so the mark never blanks again while looping.
 *
 * Geometry is the real brand mark (public/brand/icon-color.svg) and never
 * deforms; colors are the design-system tokens brand-600 / sky-400, which are
 * the mark's own colors. Honors prefers-reduced-motion by showing the static
 * mark instead.
 *
 * The bands are driven by CSS animations (tailwind `animate-nexxus-band` /
 * `animate-nexxus-ghost`), NOT SMIL: SMIL clocks run on the document timeline,
 * which does not start until the document load event, so a loader mounted
 * during hydration renders frozen until then (and rewinding the timeline via
 * setCurrentTime before it starts freezes it permanently in some engines).
 * CSS animations start when the element enters the document, so every mount
 * deterministically begins at the draw-in.
 */

const PATHS = {
  long1:
    'M147.34,79.48c.04.99.02,3.43-1.67,5.79-1.46,2.04-3.38,2.9-4.19,3.21-.14.04-.3.07-.49.08-.09,0-.18,0-.27,0h-24.64c-.12,0-1.03-.06-2.33-.51-.45-.16-.78-.28-1.18-.44-.12-.05-.24-.1-.34-.15-1.65-.72-2.81-1.49-3.9-2.22-.72-.48-1.39-.93-2.22-1.65-.95-.82-1.67-1.6-2.18-2.2l-3.35-3.27L41.75,19.27c-1.03-.76-2.54-1.59-4.41-1.66-.19,0-.38,0-.56,0H6.55c-.19.02-.37.01-.55,0-2.03-.16-3.37-2.02-3.85-2.75-.95-1.29-1.41-2.5-1.65-3.28-.28-.94-.97-3.35,0-6.03.1-.28.56-1.51,1.64-2.77.43-.5,1.28-1.48,2.73-2.18C5.68.19,7.08,0,7.08,0h36.2s.06,0,.1,0c.04,0,.08,0,.11.01,2.55.56,6.54,1.83,10.35,4.95,1.35,1.11,2.43,2.25,3.3,3.32l59.42,59.38c.44.46,1.05.99,1.84,1.49,1.19.74,2.32,1.09,3.11,1.26h19s.12,0,.23,0c.19,0,.55.05,1.28.37.21.09.49.23.81.41,0,0,.93.55,1.77,1.42,2.39,2.47,2.7,5.62,2.75,6.87Z',
  long2:
    'M0,46.17c-.04-.99-.02-3.43,1.67-5.79,1.46-2.04,3.38-2.9,4.19-3.21.14-.04.3-.07.49-.08.09,0,.18,0,.27,0h24.64c.12,0,1.03.06,2.33.51.45.16.78.28,1.18.44.12.05.24.1.34.15,1.65.72,2.81,1.49,3.9,2.22.72.48,1.39.93,2.22,1.65.95.82,1.67,1.6,2.18,2.2l3.35,3.27,58.83,58.84c1.03.76,2.54,1.59,4.41,1.66.19,0,.38,0,.56,0h30.23c.19-.02.37-.01.55,0,2.03.16,3.37,2.02,3.85,2.75.95,1.29,1.41,2.5,1.65,3.28.28.94.97,3.35,0,6.03-.1.28-.56,1.51-1.64,2.77-.43.5-1.28,1.48-2.73,2.18-.81.39-2.2.58-2.2.58h-.55c-11.36,0-22.72,0-34.08,0h-1.56s-.06,0-.1,0c-.04,0-.08,0-.11-.01-2.55-.56-6.54-1.83-10.35-4.95-1.35-1.11-2.43-2.25-3.3-3.32L30.8,57.98c-.44-.46-1.05-.99-1.84-1.49-1.19-.74-2.32-1.09-3.11-1.26h-.51c-12.33,0-18.49,0-18.49,0-.03,0-.12,0-.23,0-.19,0-.55-.05-1.28-.37-.21-.09-.49-.23-.81-.41,0,0-.93-.55-1.77-1.42C.37,50.57.06,47.42,0,46.17Z',
  accTR:
    'M95.04,31.36c.33.33,3.12,3.03,6.66,2.78.63-.04,2.69-.19,4.34-1.65.15-.13.26-.24.34-.32l12.36-11.84c.2-.22.38-.39.54-.52,1.13-.92,2.37-1.07,2.81-1.1.29-.02.53-.01.71,0h17.46c.23-.03.58-.09.99-.21,2.83-.82,4.4-3.25,4.95-4.27,1.16-2.14,1.16-4.13,1.15-4.92-.02-1.44-.34-2.59-.57-3.27-.93-2.69-3.27-5.93-6.05-6.03-.12,0-.22,0-.29,0h-22.74c-1.74.12-4.71.61-7.21,2.77-.41.35-.76.71-1.08,1.08l-15.4,15.42c-.4.58-.81,1.31-1.11,2.19-.12.36-1.04,3.14,0,6.04.33.91.84,1.81,1.07,2.2.4.71.79,1.27,1.08,1.66Z',
  accBL:
    'M52.31,94.29c-.33-.33-3.12-3.03-6.66-2.78-.63.04-2.69.19-4.34,1.65-.15.13-.26.24-.34.32l-12.36,11.84c-.2.22-.38.39-.54.52-1.13.92-2.37,1.07-2.81,1.1-.29.02-.53.01-.71,0H7.49s-.4,0-.4,0c-.23.03-.58.09-.99.21-2.83.82-4.4,3.25-4.95,4.27C-.01,113.57,0,115.56,0,116.35c.02,1.44.34,2.59.57,3.27.93,2.69,3.27,5.93,6.05,6.03.12,0,.22,0,.29,0h22.74c1.74-.12,4.71-.61,7.21-2.77.41-.35.76-.71,1.08-1.08l15.4-15.42c.4-.58.81-1.31,1.11-2.19.12-.36,1.04-3.14,0-6.04-.33-.91-.84-1.81-1.07-2.2-.4-.71-.79-1.27-1.08-1.66Z',
} as const

// Reveal bands. Each gradient is a soft-edged band laid just before its
// stroke's start point (x1,y1 -> x2,y2, along the draw axis); the translate
// carries it fully past the far end. The two accents share band index 2
// (bottom-left -> top-right), which creates the behind-the-pipelines pass.
const BANDS = [
  { x1: -189, y1: -96, x2: 7, y2: 9, tx: 336, ty: 180 },
  { x1: -205, y1: -67, x2: 0, y2: 42, tx: 352, ty: 187 },
  { x1: -205.7, y1: 302.4, x2: 0, y2: 126, tx: 353, ty: -303 },
] as const

const PIECES = [
  { d: PATHS.long1, tone: 'fill-brand-600', band: 0 },
  { d: PATHS.long2, tone: 'fill-brand-600', band: 1 },
  { d: PATHS.accBL, tone: 'fill-sky-400', band: 2 },
  { d: PATHS.accTR, tone: 'fill-sky-400', band: 2 },
] as const

export function NexxusLoader({ className }: { className?: string }) {
  // useId can contain characters that are invalid inside url(#...) references.
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '')

  return (
    <svg viewBox="0 0 147.35 125.65" className={cn('h-10 w-auto', className)} aria-hidden="true">
      <defs>
        {BANDS.map((b, i) => (
          <React.Fragment key={i}>
            <linearGradient
              id={`${uid}-g${i}`}
              gradientUnits="userSpaceOnUse"
              x1={b.x1}
              y1={b.y1}
              x2={b.x2}
              y2={b.y2}
            >
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.1" stopColor="#fff" />
              <stop offset="0.9" stopColor="#fff" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask
              id={`${uid}-m${i}`}
              maskUnits="userSpaceOnUse"
              x="-60"
              y="-70"
              width="280"
              height="270"
            >
              {/* Translating the rect moves its user space, and the
                  userSpaceOnUse gradient fill travels with it. */}
              <rect
                x="-60"
                y="-70"
                width="280"
                height="270"
                fill={`url(#${uid}-g${i})`}
                className="animate-nexxus-band"
                style={{ '--band-tx': `${b.tx}px`, '--band-ty': `${b.ty}px` } as React.CSSProperties}
              />
            </mask>
          </React.Fragment>
        ))}
      </defs>

      {/* Static mark for prefers-reduced-motion. */}
      <g className="hidden motion-reduce:block">
        {PIECES.map((p, i) => (
          <path key={i} d={p.d} className={p.tone} />
        ))}
      </g>

      <g className="motion-reduce:hidden">
        {/* Ghost: invisible during the first draw-in, fades up under the full
            mark during the hold so the first drain-out reveals it, then stays
            (animation-fill-mode: forwards). */}
        <g opacity="0" className="animate-nexxus-ghost">
          {PIECES.map((p, i) => (
            <path key={i} d={p.d} className={p.tone} />
          ))}
        </g>
        {PIECES.map((p, i) => (
          <path key={i} d={p.d} className={p.tone} mask={`url(#${uid}-m${p.band})`} />
        ))}
      </g>
    </svg>
  )
}

/**
 * Full-screen loading state shared by the dashboard layout auth guards.
 */
export function FullPageLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-dvh place-items-center bg-background">
      <div className="text-center">
        <NexxusLoader className="mx-auto mb-4 h-12" />
        <p className="text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
