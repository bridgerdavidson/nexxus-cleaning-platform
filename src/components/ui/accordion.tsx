'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AccordionContextValue {
  open: string | null
  setOpen: (value: string | null) => void
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null)

/** Single-open accordion. Items collapse via grid-rows so height animates smoothly. */
function Accordion({
  defaultValue,
  className,
  children,
}: {
  defaultValue?: string
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState<string | null>(defaultValue ?? null)
  return (
    <AccordionContext.Provider value={{ open, setOpen }}>
      <div className={cn('grid gap-3', className)}>{children}</div>
    </AccordionContext.Provider>
  )
}

function AccordionItem({
  value,
  title,
  children,
}: {
  value: string
  title: string
  children: React.ReactNode
}) {
  const ctx = React.useContext(AccordionContext)
  if (!ctx) throw new Error('AccordionItem must be used inside Accordion')
  const isOpen = ctx.open === value
  const panelId = `accordion-panel-${value}`
  const triggerId = `accordion-trigger-${value}`
  return (
    <div className="rounded-field border border-border bg-card shadow-soft-sm">
      <button
        type="button"
        id={triggerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => ctx.setOpen(isOpen ? null : value)}
        className="flex w-full items-center justify-between gap-4 rounded-field px-5 py-4 text-left text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {title}
        <ChevronDown
          className={cn(
            'size-5 shrink-0 text-muted-foreground transition-transform duration-base ease-out-soft',
            isOpen && 'rotate-180',
          )}
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className={cn(
          'grid transition-[grid-template-rows] duration-base ease-out-soft',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  )
}

export { Accordion, AccordionItem }
