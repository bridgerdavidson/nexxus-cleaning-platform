import * as React from 'react'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { Card } from './card'
import { cn } from '@/lib/utils'

export interface StatTileProps {
  label: string
  value: string
  unit?: string
  icon?: React.ReactNode
  trend?: { direction: 'up' | 'down'; label: string }
}

export function StatTile({ label, value, unit, icon, trend }: StatTileProps) {
  const up = trend?.direction === 'up'
  return (
    <Card className="p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground [&_svg]:size-5">{icon}</span> : null}
      </div>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground tnum">
        {value}{unit ? <span className="ml-1 text-xl font-bold text-muted-foreground">{unit}</span> : null}
      </p>
      {trend ? (
        <p className={cn('mt-2 inline-flex items-center gap-1 text-sm font-semibold', up ? 'text-positive-700 dark:text-positive' : 'text-critical-700 dark:text-destructive')}>
          {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
          {trend.label}
        </p>
      ) : null}
    </Card>
  )
}
