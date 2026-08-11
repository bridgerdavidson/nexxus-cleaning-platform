'use client'

import Link from 'next/link'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useScrolledPast } from '@/lib/useScrolledPast'

const LINKS = [
  { href: '#try-it', label: 'How it works' },
  { href: '#live-tracking', label: 'Live tracking' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

/** Past roughly the hero headline: the docked chrome detaches into the pill. */
const FLOAT_AT = 360

export function MarketingNav() {
  const floating = useScrolledPast(FLOAT_AT)
  return (
    // Constant 64px box in both states: content below never shifts and the
    // sections' scroll-mt-16 anchor offsets stay correct. The pill floats
    // inside this box. flex-col, so the pill's mt-2 cannot margin-collapse
    // through the header (which would pin the pill flush to the viewport edge).
    <header className="sticky top-0 z-40 flex h-16 flex-col">
      <div
        className={cn(
          'mx-auto bg-card transition-all duration-slow ease-out-soft motion-reduce:transition-none',
          floating
            ? 'mt-2 h-12 w-[calc(100%-24px)] max-w-4xl rounded-pill border border-border shadow-soft-lg'
            : 'h-16 w-full rounded-none border-b border-border',
        )}
      >
        <div
          className={cn(
            'mx-auto flex h-full w-full max-w-6xl items-center justify-between',
            floating ? 'px-3 sm:px-5' : 'px-4 sm:px-6',
          )}
        >
          <Link href="#top" aria-label="Nexxus home" className="flex items-center">
            <Logo variant="full" className="h-8" priority />
          </Link>
          <nav className="hidden items-center gap-7 md:flex" aria-label="Page sections">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-semibold text-muted-foreground transition-colors duration-base hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <a href="#waitlist">Join the waitlist</a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
