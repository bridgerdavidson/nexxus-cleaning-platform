// src/components/ui/theme-segmented.tsx
'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

/**
 * Three-way theme control (Light / Dark / System), wired to next-themes.
 * Reflects `theme` (the stored choice), not `resolvedTheme`: with System
 * selected the System segment stays active while the OS decides the look.
 * Renders the default-light selection until mounted, the standard
 * next-themes hydration guard.
 */
export function ThemeSegmented({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const selected = mounted ? (theme ?? 'light') : 'light'

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border border-border bg-muted p-1',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={selected === value}
          onClick={() => setTheme(value)}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-sm font-semibold transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected === value
              ? 'bg-card text-foreground shadow-soft-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}
