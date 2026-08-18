'use client'

import * as React from 'react'
import Link from 'next/link'
import { AnimatePresence, motion as m, useReducedMotion } from 'motion/react'
import { Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'
import { Reveal } from './Reveal'
import { EXTRA_SEAT_PRICE, PRICING_TIERS, overCap, tierTotal, type BillingPeriod } from './pricing'

const EASE = [0.22, 1, 0.36, 1] as const

export function PricingSection() {
  const [cleaners, setCleaners] = React.useState(5)
  const [period, setPeriod] = React.useState<BillingPeriod>('annual')
  const reduced = useReducedMotion() ?? false
  return (
    <section id="pricing" className="scroll-mt-16 border-y border-border bg-card">
      <Reveal className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
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

        <div className="mt-8 flex justify-center">
          <SegmentedControl<BillingPeriod>
            options={[
              { value: 'annual', label: 'Billed annually' },
              { value: 'monthly', label: 'Billed monthly' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </div>

        <div className="mx-auto mt-8 grid max-w-5xl gap-5 lg:grid-cols-3">
          {PRICING_TIERS.map((tier) => {
            const total = tierTotal(tier, period, cleaners)
            const extras = Math.max(0, cleaners - tier.includedSeats)
            const over = overCap(tier, cleaners)
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
                {/* Fixed-height stage: price and over-cap notice crossfade in the
                    same vertical rhythm as the rolling digits, no layout shift. */}
                <div className="relative mt-4 min-h-[72px]">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {over ? (
                      <m.div
                        key="capped"
                        initial={reduced ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? undefined : { opacity: 0, y: -10 }}
                        transition={{ duration: 0.25, ease: EASE }}
                      >
                        <p className="text-2xl font-extrabold tracking-tight text-foreground">Needs {tier.capNeeds}</p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">
                          {tier.name} supports up to {tier.cap} cleaners
                        </p>
                      </m.div>
                    ) : (
                      <m.div
                        key="price"
                        initial={reduced ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? undefined : { opacity: 0, y: -10 }}
                        transition={{ duration: 0.25, ease: EASE }}
                      >
                        <p className="text-4xl font-extrabold tracking-tight text-foreground tnum">
                          <AnimatedNumber value={total} prefix="$" />
                          <span className="ml-1 text-base font-semibold text-muted-foreground">/mo</span>
                        </p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground tnum">
                          {extras > 0
                            ? `$${tier.bases[period]} base + ${extras} extra ${extras === 1 ? 'seat' : 'seats'} at $${EXTRA_SEAT_PRICE}`
                            : `${tier.includedSeats} cleaner seats included`}
                          {period === 'annual' ? ', billed annually' : ''}
                        </p>
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
                <ul className="mt-5 grid flex-1 content-start gap-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-positive-700" aria-hidden />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant={tier.popular && !over ? 'default' : 'outline'} className="mt-6 w-full" asChild>
                  <Link href="/login">Try it out</Link>
                </Button>
              </Card>
            )
          })}
        </div>

        <div className="mx-auto mt-8 max-w-2xl space-y-1.5 text-center text-sm font-medium text-muted-foreground">
          <p>Every plan starts with a 14 day free trial at the Growth level. No credit card required.</p>
          <p>
            1% platform fee on jobs paid through the platform, and it includes paying your cleaners
            automatically. We only make money when you do.
          </p>
          <p>
            Card processing at cost (2.9% + 30&cent;), zero markup, and your customers never pay a
            fee. On Growth and up, ACH bank payments cost just 0.8% capped at $5, the cheapest way
            to get paid.
          </p>
        </div>
      </Reveal>
    </section>
  )
}
