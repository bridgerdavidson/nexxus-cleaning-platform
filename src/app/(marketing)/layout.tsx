import type { Metadata } from 'next'

// Marketing pages are always light: no ThemeProvider here, so the .dark class
// never applies regardless of the visitor's device preference. The .redesign
// scope supplies the Jakarta font + warm canvas tokens.
export const metadata: Metadata = {
  title: 'Nexxus, the calm way to run your cleaning company',
  description:
    'Bookings, crews, and payments in one place. Nexxus gives cleaning companies one calm screen for the office, a dead-simple app for cleaners, and self-serve booking for customers.',
  openGraph: {
    title: 'Nexxus, the calm way to run your cleaning company',
    description:
      'Bookings, crews, and payments in one place. Built for cleaning companies. Join the early access waitlist.',
    type: 'website',
    siteName: 'Nexxus',
  },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="redesign font-jakarta min-h-screen bg-background">{children}</div>
}
