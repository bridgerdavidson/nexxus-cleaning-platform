'use client';

import * as React from 'react';
import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

export interface PickerItem {
  id: string;
  label: string;
  sublabel?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
}

/**
 * A searchable single-select field (label + trigger row that opens a Popover + Command list).
 * Desktop-appropriate typeahead; works on mobile too. Used for customer, property, service,
 * checklist, and cleaner selection in the operator booking sheet.
 */
export function EntityPickerField({
  label,
  placeholder,
  value,
  items,
  onSelect,
  searchPlaceholder,
  loading,
  emptyText,
  disabled,
}: {
  /** Omit to render the field without its own heading (e.g. when wrapped in a
   *  surface that already supplies a label). */
  label?: string;
  placeholder: string;
  value: string | null;
  items: PickerItem[];
  onSelect: (id: string) => void;
  searchPlaceholder?: string;
  loading?: boolean;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value) ?? null;

  return (
    <div className="space-y-1.5">
      {label ? (
        <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-control border border-input bg-card px-3 py-2.5 text-left text-sm shadow-soft-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              !selected && 'text-muted-foreground',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder ?? 'Search...'} />
            <CommandList>
              <CommandEmpty>{loading ? 'Loading...' : emptyText ?? 'No results.'}</CommandEmpty>
              <CommandGroup>
                {items.map((i) => (
                  <CommandItem
                    key={i.id}
                    value={`${i.label} ${i.sublabel ?? ''}`}
                    disabled={i.disabled}
                    onSelect={() => {
                      onSelect(i.id);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{i.label}</div>
                      {i.sublabel && <div className="truncate text-xs text-muted-foreground">{i.sublabel}</div>}
                    </div>
                    {i.badge}
                    {value === i.id && <Check className="ml-2 size-4 shrink-0 text-brand-600" aria-hidden />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
