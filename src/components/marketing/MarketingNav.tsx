'use client'

import Link from 'next/link'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'

const LINKS = [
  { href: '#try-it', label: 'How it works' },
  { href: '#live-tracking', label: 'Live tracking' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

export function MarketingNav() {
  return (
    // Docked app chrome, the same vocabulary as the in-product top bars:
    // solid card surface with a hairline. Deliberately static on scroll.
    <header className="sticky top-0 z-40 h-16 border-b border-border bg-card">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4 sm:px-6">
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
    </header>
  )
}
