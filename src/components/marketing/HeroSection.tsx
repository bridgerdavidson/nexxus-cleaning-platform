'use client'

import { motion as m } from 'motion/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FlowShowcase } from './FlowShowcase'

const EASE = [0.16, 1, 0.3, 1] as const

export function HeroSection() {
  return (
    <section id="top" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-3xl text-center">
        <m.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <Badge variant="secondary" className="mb-5">
            Built for cleaning work
          </Badge>
          <h1 className="text-4xl font-extrabold leading-[1.06] tracking-tight text-foreground sm:text-6xl">
            Every job, from &ldquo;booked&rdquo; to &ldquo;paid,&rdquo; without the chaos.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg font-medium leading-relaxed text-muted-foreground">
            Bookings, crews, and payments in one place. Cleaning companies, commercial crews,
            property turnovers. If your business runs on cleaning, it fits.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild>
              <a href="#waitlist">Join the waitlist</a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#try-it">See the product</a>
            </Button>
          </div>
        </m.div>
      </div>
      <m.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
        className="mt-12 sm:mt-16"
      >
        <FlowShowcase />
      </m.div>
    </section>
  )
}
