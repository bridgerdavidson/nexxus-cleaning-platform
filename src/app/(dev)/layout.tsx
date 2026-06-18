// src/app/(dev)/layout.tsx
import { notFound } from 'next/navigation'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { Toaster } from '@/components/ui/sonner'

// Dev-only. Never ships to prod users unless explicitly enabled on a preview.
const enabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_UI_KIT_ENABLED === 'true'

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!enabled) notFound()
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">
        {children}
        <Toaster position="top-right" />
      </div>
    </ThemeProvider>
  )
}
