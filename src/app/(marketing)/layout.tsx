import type { Metadata, Viewport } from 'next'

// iOS Safari paints the safe area (status bar / notch chrome) with theme-color.
// Pin it to the SAME surface MarketingNav paints (bg-card, white) so the chrome
// and the nav read as one continuous piece at every scroll position. If the
// nav's surface ever changes, this must change with it. Only themeColor is set:
// segment viewports shallow-merge per key, so width/scale/viewportFit still
// come from the root layout.
export const viewport: Viewport = {
  themeColor: '#ffffff',
}

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
