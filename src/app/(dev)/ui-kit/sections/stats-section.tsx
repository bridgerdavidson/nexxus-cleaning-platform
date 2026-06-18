// src/app/(dev)/ui-kit/sections/stats-section.tsx
import * as React from 'react'
import { DollarSign, CalendarCheck, Activity } from 'lucide-react'
import { StatTile } from '@/components/ui/stat-tile'
import { Section } from './section'

export function StatsSection() {
  return (
    <Section id="stats" title="Stat Tile / KPI">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Revenue this month"
          value="$8,920.00"
          icon={<DollarSign />}
          trend={{ direction: 'up', label: '12%' }}
        />
        <StatTile
          label="Jobs today"
          value="14"
          icon={<CalendarCheck />}
        />
        <StatTile
          label="In progress"
          value="3"
          icon={<Activity />}
        />
      </div>
    </Section>
  )
}
