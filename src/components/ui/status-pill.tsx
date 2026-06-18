// src/components/ui/status-pill.tsx
import * as React from 'react'
import {
  CalendarClock,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react'
import { Badge, type BadgeProps } from './badge'

type AppointmentStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'pending'

interface StatusConfig {
  variant: BadgeProps['variant']
  Icon: React.ComponentType<{ className?: string }>
  label: string
}

const STATUS_MAP: Record<AppointmentStatus, StatusConfig> = {
  scheduled:   { variant: 'info',      Icon: CalendarClock,  label: 'Scheduled' },
  in_progress: { variant: 'default',   Icon: Loader2,        label: 'In Progress' },
  completed:   { variant: 'positive',  Icon: CheckCircle2,   label: 'Completed' },
  cancelled:   { variant: 'critical',  Icon: XCircle,        label: 'Cancelled' },
  pending:     { variant: 'caution',   Icon: Clock,          label: 'Pending' },
}

export interface StatusPillProps {
  status: AppointmentStatus
  /** Override the display label. Falls back to the default for the status. */
  label?: string
  className?: string
}

function StatusPill({ status, label, className }: StatusPillProps) {
  const config = STATUS_MAP[status]
  if (!config) return null
  const { variant, Icon, label: defaultLabel } = config
  return (
    <Badge variant={variant} className={className}>
      <Icon />
      {label ?? defaultLabel}
    </Badge>
  )
}

export { StatusPill }
