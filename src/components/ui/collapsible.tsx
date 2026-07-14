'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A single, independently-toggled collapsible section for the booking sheet.
 * Unlike ui/accordion (single-open, card chrome), each Collapsible owns its own
 * open state so several can be open at once. Smooth height via grid-template-rows.
 */
export function Collapsible({
  title,
  defaultOpen = false,
  right,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const panelId = `collapsible-${id}`;
  const triggerId = `collapsible-trigger-${id}`;
  return (
    <div>
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-control py-1.5 text-left text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <ChevronDown
            className={cn('size-4 shrink-0 transition-transform duration-base ease-out-soft', open && 'rotate-180')}
            aria-hidden
          />
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className={cn('grid transition-[grid-template-rows] duration-base ease-out-soft', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
      >
        <div className="overflow-hidden">
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
