'use client'

import * as React from 'react'
import { CalendarX2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { NexxusLoader } from '@/components/ui/nexxus-loader'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Section, Specimen } from './section'

export function FeedbackSection() {
  return (
    <Section id="feedback" title="Feedback + Structure">
      {/* Tooltip */}
      <Specimen label="Tooltip (hover or focus the button)">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Schedule a new booking</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Specimen>

      {/* Separator */}
      <Specimen label="Separator">
        <div className="w-full space-y-4">
          <p className="text-sm text-foreground">Section A content</p>
          <Separator />
          <p className="text-sm text-foreground">Section B content</p>
        </div>
        <div className="flex h-10 items-center gap-4">
          <span className="text-sm text-foreground">Left</span>
          <Separator orientation="vertical" />
          <span className="text-sm text-foreground">Right</span>
        </div>
      </Specimen>

      {/* Skeleton */}
      <Specimen label="Skeleton">
        <div className="flex items-center gap-4">
          {/* Circle avatar placeholder */}
          <Skeleton className="size-12 rounded-pill" />
          <div className="space-y-2">
            {/* Title bar */}
            <Skeleton className="h-4 w-40" />
            {/* Text line */}
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </Specimen>

      {/* NexxusLoader */}
      <Specimen label="Nexxus loader (auth / full-page waits)">
        <div className="flex items-end gap-10">
          <NexxusLoader className="h-8" />
          <NexxusLoader className="h-12" />
          <NexxusLoader className="h-20" />
        </div>
      </Specimen>

      {/* EmptyState */}
      <Specimen label="Empty State" className="block">
        <EmptyState
          icon={<CalendarX2 />}
          title="No bookings yet"
          description="Once a homeowner schedules a cleaning, it will appear here."
          action={<Button>New booking</Button>}
        />
      </Specimen>

      {/* ErrorState */}
      <Specimen label="Error State" className="block">
        <ErrorState title="Couldn't load payments" description="Something went wrong loading this. Please try again." onRetry={() => {}} />
      </Specimen>
    </Section>
  )
}
