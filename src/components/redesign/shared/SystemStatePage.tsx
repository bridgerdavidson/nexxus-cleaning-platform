'use client'

import * as React from 'react'
import Link from 'next/link'
import { Logo } from '@/components/ui/logo'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SystemStateAction = {
  label: string
  href?: string
  onClick?: () => void
  variant?: 'primary' | 'outline'
}

export function SystemStatePage({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions: SystemStateAction[]
}) {
  return (
    <div className="redesign font-jakarta flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <Logo variant="full" className="h-8 w-auto" />
      <div className="mt-12 flex w-full max-w-sm flex-col items-center">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        {actions.length > 0 && (
          <div className="mt-8 flex w-full flex-col gap-3">
            {actions.map((a, i) => {
              const variant = a.variant === 'outline' ? 'outline' : 'default'
              // Render link actions as a styled <Link>, not <Button asChild>: the
              // Button always emits a loading-slot child, so Slot sees two children
              // and throws. buttonVariants gives the same look without Slot.
              return a.href ? (
                <Link key={i} href={a.href} className={cn(buttonVariants({ variant, size: 'lg' }), 'w-full')}>
                  {a.label}
                </Link>
              ) : (
                <Button key={i} variant={variant} size="lg" className="w-full" onClick={a.onClick}>
                  {a.label}
                </Button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
