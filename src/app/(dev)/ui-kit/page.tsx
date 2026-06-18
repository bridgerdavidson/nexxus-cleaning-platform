// src/app/(dev)/ui-kit/page.tsx
'use client'

import { ThemeToggle } from '@/components/ui/theme-toggle'

export default function UiKitPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground">Nexxus UI Kit</h1>
          <p className="mt-2 text-base text-muted-foreground">
            Redesign primitives. Plus Jakarta Sans, warm canvas, brand blue, pillowy shapes. Toggle the theme to verify both.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="grid gap-16">
        {/* Sections appended here as components land (Tasks 9-29). */}
        <p className="text-sm text-muted-foreground">Sections render here as primitives are built.</p>
      </div>
    </div>
  )
}
