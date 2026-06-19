'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Section, Specimen } from './section'

type CalendarView = 'day' | 'week' | 'month'

export function TabsSection() {
  const [calView, setCalView] = useState<CalendarView>('week')

  return (
    <Section id="tabs" title="Tabs + Segmented Control">
      <Specimen label="Tabs (3 panels)">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="rounded-card border border-border bg-background p-4 text-sm text-foreground">
            Overview panel content. Summary of recent activity and key metrics.
          </TabsContent>
          <TabsContent value="schedule" className="rounded-card border border-border bg-background p-4 text-sm text-foreground">
            Schedule panel content. Upcoming appointments and cleaner availability.
          </TabsContent>
          <TabsContent value="payments" className="rounded-card border border-border bg-background p-4 text-sm text-foreground">
            Payments panel content. Recent transactions and payout status.
          </TabsContent>
        </Tabs>
      </Specimen>

      <Specimen label="Segmented Control (Day / Week / Month)">
        <SegmentedControl<CalendarView>
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
          value={calView}
          onChange={setCalView}
        />
        <span className="text-sm text-muted-foreground">
          Active: <span className="font-semibold text-foreground capitalize">{calView}</span>
        </span>
      </Specimen>
    </Section>
  )
}
