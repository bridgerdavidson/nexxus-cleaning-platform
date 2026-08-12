import * as React from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  /** Smaller paddings + size-6 icon for embedded surfaces (pickers, panes). */
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-card/50 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-12',
      )}
    >
      {icon ? (
        <div className={cn('text-muted-foreground', compact ? 'mb-2 [&_svg]:size-6' : 'mb-4 [&_svg]:size-10')}>
          {icon}
        </div>
      ) : null}
      <h3 className={cn('font-bold text-foreground', compact ? 'text-sm' : 'text-lg')}>{title}</h3>
      {description ? (
        <p className={cn('mt-1 max-w-sm text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          {description}
        </p>
      ) : null}
      {action ? <div className={compact ? 'mt-4' : 'mt-6'}>{action}</div> : null}
    </div>
  )
}
