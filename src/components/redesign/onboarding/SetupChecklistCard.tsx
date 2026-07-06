'use client';

import Link from 'next/link';
import { Check, ChevronRight, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChecklistVM } from '@/lib/onboarding/deriveChecklist';

export function SetupChecklistCard({
  title,
  subtitle,
  vm,
  onDismiss,
}: {
  title: string;
  subtitle: string;
  vm: ChecklistVM;
  onDismiss: () => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-primary">Get started</p>
          <h3 className="mt-1.5 text-lg font-extrabold tracking-tight text-foreground">{title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm font-extrabold tabular-nums text-foreground">
            {vm.requiredDone}
            <span className="text-muted-foreground/60">/{vm.requiredTotal}</span>
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss setup checklist"
            className="grid h-8 w-8 place-items-center rounded-pill border border-border bg-card text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Progress value={vm.progressPercent} className="my-4" aria-label="Setup progress" />

      <ul className="divide-y divide-muted">
        {vm.items.map((item) => (
          <li key={item.key} className="flex items-center gap-3.5 py-3.5">
            <span
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-pill',
                item.done && 'bg-positive text-white',
                !item.done && item.isNext && 'border-[1.5px] border-brand-100 bg-brand-50 text-primary',
                !item.done && !item.isNext && 'border-[1.5px] border-border bg-card text-muted-foreground/60',
              )}
            >
              {item.done ? <Check className="h-[18px] w-[18px]" strokeWidth={3} /> : <ChevronRight className="h-[18px] w-[18px]" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className={cn('text-[15px] font-bold', item.done && 'text-muted-foreground line-through decoration-border')}>
                {item.title}
                {!item.required && (
                  <span className="ml-2 rounded-pill bg-muted px-2 py-0.5 align-middle text-[11px] font-semibold text-muted-foreground">
                    Optional
                  </span>
                )}
              </p>
              {!item.done && <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>}
            </div>

            {item.done ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-bold text-positive-700">
                <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />
                Done
              </span>
            ) : item.isNext ? (
              <Link href={item.href} className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'shrink-0')}>
                {item.ctaLabel}
              </Link>
            ) : (
              <Link href={item.href} aria-label={item.ctaLabel} className="shrink-0 text-muted-foreground/60 hover:text-foreground">
                <ChevronRight className="h-5 w-5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
