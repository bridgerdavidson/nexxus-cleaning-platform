'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'

interface Tier {
  name: string
  base: number
  includedSeats: number
  extraSeat: number
  blurb: string
  features: string[]
  popular?: boolean
}

// Placeholder early-access numbers (ZenMaid seat model x Jobber tiers).
// See brainstorming/2026-07-06-landing-page-grill-session.md before changing.
const TIERS: Tier[] = [
  {
    name: 'Starter',
    base: 29,
    includedSeats: 2,
    extraSeat: 10,
    blurb: 'For solo operators and first hires.',
    features: [
      'Online booking and scheduling',
      'Dispatch calendar',
      'Cleaner mobile app',
      'Card payments',
    ],
  },
  {
    name: 'Growth',
    base: 79,
    includedSeats: 5,
    extraSeat: 8,
    blurb: 'For companies ready to stop doing office work at night.',
    popular: true,
    features: [
      'Everything in Starter',
      'Customer portal with self-serve rescheduling',
      'Recurring visits and automatic reminders',
      'Job photos and checklists',
      'Automatic cleaner payouts',
    ],
  },
  {
    name: 'Pro',
    base: 149,
    includedSeats: 10,
    extraSeat: 6,
    blurb: 'For established crews with managers and payroll.',
    features: [
      'Everything in Growth',
      'Manager roles and permissions',
      'Payroll and payout automation',
      'Advanced reports',
      'Priority support',
    ],
  },
]

function tierTotal(tier: Tier, cleaners: number): number {
  return tier.base + Math.max(0, cleaners - tier.includedSeats) * tier.extraSeat
}

export function PricingSection() {
  const [cleaners, setCleaners] = React.useState(5)
  return (
    <section id="pricing" className="scroll-mt-16 border-y border-border bg-card">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary">Simple pricing</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Priced like you price: by the crew
          </h2>
          <p className="mt-3 text-base font-medium text-muted-foreground">
            Cleaner seats are the only thing you pay for. Office staff are unlimited and your
            customers never pay a thing.
          </p>
        </div>

        <Card className="mx-auto mt-10 max-w-xl p-6">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="crew-size" className="text-sm font-bold text-foreground">
              How many cleaners on your team?
            </Label>
            <span className="rounded-pill bg-accent px-3.5 py-1 text-sm font-bold text-accent-foreground tnum">
              {cleaners === 25 ? '25+' : cleaners}
            </span>
          </div>
          <Slider
            id="crew-size"
            min={1}
            max={25}
            step={1}
            value={cleaners}
            onChange={(e) => setCleaners(Number(e.target.value))}
            className="mt-4"
            aria-valuetext={`${cleaners} cleaners`}
          />
          <div className="mt-1.5 flex justify-between text-xs font-medium text-muted-foreground" aria-hidden>
            <span>Just me</span>
            <span>25+</span>
          </div>
        </Card>

        <div className="mx-auto mt-8 grid max-w-5xl gap-5 lg:grid-cols-3">
          {TIERS.map((tier) => {
            const total = tierTotal(tier, cleaners)
            const extras = Math.max(0, cleaners - tier.includedSeats)
            return (
              <Card
                key={tier.name}
                className={cn('relative flex flex-col p-6', tier.popular && 'border-2 border-primary shadow-soft-lg')}
              >
                {tier.popular ? (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                    Most popular
                  </Badge>
                ) : null}
                <h3 className="text-lg font-bold text-foreground">{tier.name}</h3>
                <p className="mt-1 min-h-10 text-sm text-muted-foreground">{tier.blurb}</p>
                <p className="mt-4 text-4xl font-extrabold tracking-tight text-foreground tnum">
                  <AnimatedNumber value={total} prefix="$" />
                  <span className="ml-1 text-base font-semibold text-muted-foreground">/mo</span>
                </p>
                <p className="mt-1 text-xs font-medium text-muted-foreground tnum">
                  {extras > 0
                    ? `$${tier.base} base + ${extras} extra ${extras === 1 ? 'seat' : 'seats'} at $${tier.extraSeat}`
                    : `${tier.includedSeats} cleaner ${tier.includedSeats === 1 ? 'seat' : 'seats'} included`}
                </p>
                <ul className="mt-5 grid flex-1 content-start gap-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-positive-700" aria-hidden />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant={tier.popular ? 'default' : 'outline'} className="mt-6 w-full" asChild>
                  <a href="#waitlist">Join the waitlist</a>
                </Button>
              </Card>
            )
          })}
        </div>

        <p className="mt-8 text-center text-sm font-medium text-muted-foreground">
          Early access pricing. Lock it in by joining the waitlist. Two months free when billed
          annually, and every plan starts with a 14 day free trial.
        </p>
      </div>
    </section>
  )
}
