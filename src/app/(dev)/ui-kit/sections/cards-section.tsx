'use client'

import * as React from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Section, Specimen } from './section'

export function CardsSection() {
  const [isPressed, setIsPressed] = React.useState(false)

  return (
    <Section id="cards" title="Cards">
      <Specimen label="Today's Jobs (with footer button)">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Today's jobs</CardTitle>
            <CardDescription>3 appointments scheduled for today</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-control border border-border bg-background p-3">
                <div>
                  <p className="text-sm font-medium">Morning Clean</p>
                  <p className="text-xs text-muted-foreground">9:00 AM - 10:30 AM</p>
                </div>
                <span className="inline-block rounded-chip bg-positive/10 px-2 py-1 text-xs font-semibold text-positive">Confirmed</span>
              </div>
              <div className="flex items-center justify-between rounded-control border border-border bg-background p-3">
                <div>
                  <p className="text-sm font-medium">Deep Clean</p>
                  <p className="text-xs text-muted-foreground">2:00 PM - 4:00 PM</p>
                </div>
                <span className="inline-block rounded-chip bg-caution/10 px-2 py-1 text-xs font-semibold text-caution">Pending</span>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button>New booking</Button>
          </CardFooter>
        </Card>
      </Specimen>

      <Specimen label="Interactive Card (tappable with hover and active states)">
        <Card
          className="w-full max-w-sm cursor-pointer transition-all active:scale-[0.99] hover:shadow-soft-lg"
          onMouseDown={() => setIsPressed(true)}
          onMouseUp={() => setIsPressed(false)}
          onMouseLeave={() => setIsPressed(false)}
        >
          <CardHeader>
            <CardTitle>Service Details</CardTitle>
            <CardDescription>Click or tap to interact</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground">
              {isPressed ? 'Card is active' : 'This card responds to interaction'}
            </p>
          </CardContent>
        </Card>
      </Specimen>
    </Section>
  )
}
