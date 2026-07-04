import React from 'react';
import { Logo } from '@/components/ui/logo';

interface AuthShellProps {
  children: React.ReactNode;
  panelTitle?: string;
  panelSubtitle?: string;
}

/**
 * Shared auth chrome (login / forgot / reset / accept-invite). Split-screen on
 * desktop (blue brand panel + form card); on mobile the panel is hidden and the
 * black lockup sits above the card. Wrapped in `.redesign font-jakarta` so the
 * brand tokens + Plus Jakarta Sans apply outside the (redesign) route group.
 * Light mode only (no ThemeProvider here).
 */
export function AuthShell({
  children,
  panelTitle = 'Cleaning, handled.',
  panelSubtitle = 'Booked, tracked, and paid in one place.',
}: AuthShellProps) {
  return (
    <div className="redesign font-jakarta min-h-screen bg-background text-foreground md:grid md:grid-cols-[minmax(0,44%)_minmax(0,56%)]">
      <aside className="relative hidden overflow-hidden bg-brand-600 p-10 text-white md:flex md:flex-col md:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border border-white/15" aria-hidden />
        <div className="pointer-events-none absolute -left-16 bottom-24 size-44 rounded-full border border-white/15" aria-hidden />
        {/* Wrapped so the image is not a direct flex child (align-items would
            stretch it to the full column width and break its aspect ratio). */}
        <div>
          <Logo variant="full" onDark className="h-9 w-auto" priority />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">{panelTitle}</h2>
          <p className="mt-2 text-lg font-medium text-white/90">{panelSubtitle}</p>
        </div>
        <p className="text-sm text-white/80">Cleaning Solutions</p>
      </aside>

      <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
        <div className="mb-7 md:hidden">
          <Logo variant="full" className="h-9 w-auto" priority />
        </div>
        <div className="w-full max-w-sm rounded-card border border-border bg-card p-6 shadow-soft-lg sm:max-w-md sm:p-7">
          {children}
        </div>
      </main>
    </div>
  );
}

export default AuthShell;
