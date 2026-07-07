import Link from 'next/link'
import { Logo } from '@/components/ui/logo'

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
        <Logo variant="full" className="h-7" />
        <nav className="flex items-center gap-6 text-sm font-medium text-muted-foreground" aria-label="Footer">
          <a href="#pricing" className="transition-colors duration-base hover:text-foreground">Pricing</a>
          <a href="#faq" className="transition-colors duration-base hover:text-foreground">FAQ</a>
          <Link href="/login" className="transition-colors duration-base hover:text-foreground">Log in</Link>
        </nav>
        <p className="text-sm text-muted-foreground">© 2026 Nexxus. All rights reserved.</p>
      </div>
    </footer>
  )
}
