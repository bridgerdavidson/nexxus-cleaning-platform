// src/app/(dev)/ui-kit/sections/section.tsx
import * as React from 'react'

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
      <div className="mt-6 grid gap-8">{children}</div>
    </section>
  )
}

export function Specimen({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <div className={`flex flex-wrap items-center gap-4 rounded-card border border-border bg-card p-6 shadow-soft-sm ${className}`}>
        {children}
      </div>
    </div>
  )
}
