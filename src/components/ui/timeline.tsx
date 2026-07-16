// src/components/ui/timeline.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A minimal vertical timeline: connector line + one dot per item. Built for
 * the booking sheet's routing history; a future payment-attempts history is
 * expected to reuse it. Deliberately tiny API: stacked items, `current`
 * highlights one dot. No icons-in-dots, no branching.
 */
function Timeline({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ol className={cn('relative ml-1.5 space-y-4 border-l border-border pl-4', className)}>{children}</ol>
}

function TimelineItem({ current, children }: { current?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className={cn(
          'absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-background',
          current ? 'bg-primary' : 'bg-border',
        )}
      />
      {children}
    </li>
  )
}

export { Timeline, TimelineItem }
