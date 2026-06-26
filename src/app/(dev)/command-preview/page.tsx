'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { OPERATOR_NAV } from '@/components/redesign/shell/nav-items';
import {
  deriveCommandResults,
  type PaletteBooking,
  type PaletteCustomer,
  type PaletteCleaner,
  type PaletteService,
} from '@/components/redesign/command/deriveCommandResults';

const BOOKINGS: PaletteBooking[] = [
  { id: 'b1', customerName: 'Jordan Avery', cleanerName: 'Wanda Jacobs', property: '123 Oak St', service: 'Deep clean', dateLabel: 'Jun 27' },
  { id: 'b2', customerName: 'Priya Shah', cleanerName: 'Diego Torres', property: '88 Oak Lane', service: 'Standard clean', dateLabel: 'Jun 28' },
];
const CUSTOMERS: PaletteCustomer[] = [
  { id: 'c1', name: 'Jordan Avery', email: 'jordan@example.com', phone: '801-555-0142' },
  { id: 'c2', name: 'Marcus Lee', email: 'marcus@example.com', phone: '801-555-0199' },
];
const CLEANERS: PaletteCleaner[] = [
  { id: 'cl1', name: 'Wanda Jacobs', email: 'wanda@example.com', roleLabel: 'Cleaner' },
];
const SERVICES: PaletteService[] = [
  { id: 's1', name: 'Deep clean', priceLabel: '$160' },
  { id: 's2', name: 'Move-out clean', priceLabel: '$220' },
];

export default function CommandPreviewPage() {
  const [query, setQuery] = useState('');

  const groups = deriveCommandResults({
    query,
    bookings: BOOKINGS,
    customers: CUSTOMERS,
    cleaners: CLEANERS,
    services: SERVICES,
    permissions: { bookings: true, customers: true, cleaners: true, services: true },
    nav: OPERATOR_NAV.map((n) => ({ id: n.id, label: n.label, href: n.href, icon: n.icon })),
    actions: [{ id: 'new-booking', label: 'New booking', keywords: 'create add appointment', icon: Plus }],
  });

  return (
    <div className="redesign min-h-screen bg-background p-8 font-jakarta">
      <h1 className="mb-2 text-lg font-bold text-foreground">Command palette preview</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Empty query shows quick actions; type to search (try &quot;oak&quot;, &quot;jordan&quot;, &quot;clean&quot;).
      </p>
      <div className="w-full max-w-xl overflow-hidden rounded-card border border-border bg-popover shadow-soft-lg">
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search bookings, customers, cleaners, services..."
          />
          <CommandList>
            <CommandEmpty>{query ? `No results for "${query}"` : 'Start typing to search.'}</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.group} heading={g.group}>
                {g.items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <CommandItem key={it.key} value={it.key} onSelect={() => {}}>
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.sublabel ? (
                        <span className="ml-2 max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                          {it.sublabel}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
                {g.overflow > 0 ? (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">+{g.overflow} more, refine your search</p>
                ) : null}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
