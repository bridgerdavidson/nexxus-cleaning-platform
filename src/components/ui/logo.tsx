'use client'

import * as React from 'react'
import Image from 'next/image'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

type LogoProps = {
  variant?: 'mark' | 'full'
  tone?: 'color' | 'mono' | 'auto'
  className?: string
  priority?: boolean
}

// Map (variant, resolved appearance) -> asset path. Adjust paths to match `ls public/brand`.
const ASSET: Record<string, string> = {
  'mark-color': '/brand/icon-color.svg',
  'mark-mono-light': '/brand/icon-dark.svg',   // dark mark for light bg
  'mark-mono-dark': '/brand/icon-light.svg',   // light mark for dark bg
  'full-color-light': '/brand/logo-black.svg',
  'full-color-dark': '/brand/logo-white.svg',
}

export function Logo({ variant = 'full', tone = 'auto', className, priority }: LogoProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const appearance = mounted && resolvedTheme === 'dark' ? 'dark' : 'light'

  let src: string
  if (variant === 'mark') {
    src = tone === 'color' ? ASSET['mark-color'] : ASSET[`mark-mono-${appearance}`]
  } else {
    src = ASSET[`full-color-${appearance}`]
  }

  const dims = variant === 'mark' ? { width: 40, height: 40 } : { width: 168, height: 40 }
  return (
    <Image
      src={src}
      alt="Nexxus"
      {...dims}
      priority={priority}
      style={{ width: 'auto', height: 'auto' }}
      className={cn('h-10 w-auto select-none', className)}
    />
  )
}
