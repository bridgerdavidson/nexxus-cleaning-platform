// src/app/(dev)/layout.tsx
import { notFound } from 'next/navigation'
import { ThemeProvider } from '@/components/ui/theme-provider'

// The /ui-kit gallery is a DEV + PREVIEW ONLY surface. It must never be
// reachable in production. Allowed when:
//   - running locally (NODE_ENV !== 'production'), or
//   - on a Vercel preview deployment (VERCEL_ENV === 'preview').
// On Vercel production (VERCEL_ENV === 'production') it 404s.
// Evaluated per-request (force-dynamic) so the runtime env is authoritative.
export const dynamic = 'force-dynamic'

export default function DevLayout({ children }: { children: React.ReactNode }) {
  const allowed =
    process.env.NODE_ENV !== 'production' ||
    process.env.VERCEL_ENV === 'preview'
  if (!allowed) notFound()
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">
        {children}
      </div>
    </ThemeProvider>
  )
}
