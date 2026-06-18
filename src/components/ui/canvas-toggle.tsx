// src/components/ui/canvas-toggle.tsx
'use client'

import * as React from 'react'
import { Palette } from 'lucide-react'

type CanvasTemp = 'warm' | 'slate' | 'neutral'

const TEMPS: CanvasTemp[] = ['warm', 'slate', 'neutral']
const LABELS: Record<CanvasTemp, string> = { warm: 'Warm', slate: 'Slate', neutral: 'Neutral' }
const STORAGE_KEY = 'nexxus-canvas'

function applyCanvas(temp: CanvasTemp) {
  if (temp === 'warm') {
    document.documentElement.removeAttribute('data-canvas')
  } else {
    document.documentElement.setAttribute('data-canvas', temp)
  }
}

export function CanvasToggle() {
  const [mounted, setMounted] = React.useState(false)
  const [temp, setTemp] = React.useState<CanvasTemp>('warm')

  React.useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as CanvasTemp | null
    const initial: CanvasTemp = saved && TEMPS.includes(saved) ? saved : 'warm'
    setTemp(initial)
    applyCanvas(initial)
    setMounted(true)
  }, [])

  function cycle() {
    const next = TEMPS[(TEMPS.indexOf(temp) + 1) % TEMPS.length]
    setTemp(next)
    applyCanvas(next)
    localStorage.setItem(STORAGE_KEY, next)
  }

  const label = mounted ? LABELS[temp] : 'Warm'

  return (
    <button
      type="button"
      aria-label={`Canvas color: ${label}. Click to cycle.`}
      onClick={cycle}
      className="inline-flex h-11 items-center gap-2 rounded-pill border border-border bg-card px-4 text-sm font-medium text-foreground shadow-soft-sm transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Palette className="h-4 w-4 shrink-0" />
      {label}
    </button>
  )
}
