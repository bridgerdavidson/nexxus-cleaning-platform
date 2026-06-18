'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = 'default' | 'success' | 'error' | 'info' | 'warning'

export interface ToastRecord {
  id: number
  variant: ToastVariant
  title: React.ReactNode
  description?: React.ReactNode
  duration?: number
}

type ToastOpts = { description?: React.ReactNode; duration?: number }

// ---------------------------------------------------------------------------
// Module-level store
// ---------------------------------------------------------------------------

// Anchor the store on globalThis so that if this module gets instantiated more
// than once (Turbopack / RSC client-boundary duplication), every copy shares
// ONE store. Otherwise toast() and <Toaster> can land on separate stores and
// nothing ever renders.
type ToastStore = {
  id: number
  toasts: ToastRecord[]
  listeners: Set<(toasts: ToastRecord[]) => void>
}

const store: ToastStore = ((
  globalThis as unknown as { __nexxusToastStore?: ToastStore }
).__nexxusToastStore ??= { id: 0, toasts: [], listeners: new Set() })

function emit() {
  store.listeners.forEach((fn) => fn([...store.toasts]))
}

function remove(id: number) {
  store.toasts = store.toasts.filter((t) => t.id !== id)
  emit()
}

function add(partial: Omit<ToastRecord, 'id'>): number {
  const id = ++store.id
  store.toasts = [{ ...partial, id }, ...store.toasts]
  emit()

  // Skip auto-dismiss when duration is explicitly 0 or Infinity
  const { duration } = partial
  const skip = duration === 0 || duration === Infinity
  if (!skip) {
    setTimeout(() => remove(id), duration ?? 4000)
  }

  return id
}

// ---------------------------------------------------------------------------
// Public toast API (sonner-compatible surface)
// ---------------------------------------------------------------------------

function toastFn(title: React.ReactNode, opts?: ToastOpts): number {
  return add({ variant: 'default', title, ...opts })
}

toastFn.success = (title: React.ReactNode, opts?: ToastOpts) =>
  add({ variant: 'success', title, ...opts })

toastFn.error = (title: React.ReactNode, opts?: ToastOpts) =>
  add({ variant: 'error', title, ...opts })

toastFn.info = (title: React.ReactNode, opts?: ToastOpts) =>
  add({ variant: 'info', title, ...opts })

toastFn.warning = (title: React.ReactNode, opts?: ToastOpts) =>
  add({ variant: 'warning', title, ...opts })

toastFn.dismiss = (id: number) => remove(id)

export const toast = toastFn

// ---------------------------------------------------------------------------
// ToastCard
// ---------------------------------------------------------------------------

const chipConfig: Record<
  Exclude<ToastVariant, 'default'>,
  { bg: string; icon: React.ReactNode }
> = {
  success: { bg: 'bg-positive', icon: <Check className="size-4 text-white" /> },
  error:   { bg: 'bg-destructive', icon: <X className="size-4 text-white" /> },
  info:    { bg: 'bg-info', icon: <Info className="size-4 text-white" /> },
  warning: { bg: 'bg-caution', icon: <TriangleAlert className="size-4 text-white" /> },
}

function ToastCard({ id, variant, title, description }: ToastRecord) {
  const chip = variant !== 'default' ? chipConfig[variant] : null
  const isAlert = variant === 'error' || variant === 'warning'

  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3',
        'rounded-card border border-border bg-popover p-4 text-popover-foreground shadow-soft-lg',
        'animate-in fade-in-0 slide-in-from-top-2',
      )}
    >
      {chip && (
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            chip.bg,
          )}
        >
          {chip.icon}
        </span>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => toast.dismiss(id)}
        className={cn(
          'shrink-0 rounded-pill p-1 text-muted-foreground',
          'hover:bg-muted hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toaster
// ---------------------------------------------------------------------------

type Position = 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center'

const positionClasses: Record<Position, string> = {
  'top-right':     'top-0 right-0 items-end',
  'top-center':    'top-0 left-1/2 -translate-x-1/2 items-center',
  'bottom-right':  'bottom-0 right-0 items-end',
  'bottom-center': 'bottom-0 left-1/2 -translate-x-1/2 items-center',
}

export function Toaster({ position = 'top-right' }: { position?: Position }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([...store.toasts])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setToasts([...store.toasts])
    store.listeners.add(setToasts)
    return () => {
      store.listeners.delete(setToasts)
    }
  }, [])

  if (!mounted) return null

  return createPortal(
    <div
      className={cn(
        'pointer-events-none fixed z-[100] flex w-full max-w-[420px] flex-col gap-3 p-4',
        positionClasses[position],
      )}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} {...t} />
      ))}
    </div>,
    document.body,
  )
}
