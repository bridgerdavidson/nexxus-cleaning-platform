import type { Metadata } from 'next'

// Marketing pages are always light: no ThemeProvider here, so the .dark class
// never applies regardless of the visitor's device preference. The .redesign
// scope supplies the Jakarta font + warm canvas tokens.
// Brand first, so a truncated tab still reads "Nexxus · Run...". The old title
// ran 48 characters, and a tab shows roughly 20: the descriptor never survived
// where it was actually being read. This one is 34 and still carries the
// audience and the search keyword. The description does the long-form work,
// which is the field search results and share cards actually quote at length.
export const metadata: Metadata = {
  title: 'Nexxus · Run your cleaning company',
  description:
    'Bookings, crews, and payments in one place. Nexxus gives cleaning companies one calm screen for the office, a dead-simple app for cleaners, and self-serve booking for customers.',
  openGraph: {
    title: 'Nexxus · Run your cleaning company',
    description:
      'Bookings, crews, and payments in one place. Built for cleaning companies. Join the early access waitlist.',
    type: 'website',
    siteName: 'Nexxus',
  },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="redesign font-jakarta min-h-screen bg-background">{children}</div>
}
