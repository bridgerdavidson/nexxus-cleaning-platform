'use client';

import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { Appointment } from '@/hooks/useHomeownerData';
import type { CleaningSection } from './derive-cleanings';
import { CleaningRow } from './CleaningRow';

export function HomeownerCleaningsView({
  sections,
  isEmpty,
  loading,
  onOpen,
}: {
  sections: CleaningSection[];
  isEmpty: boolean;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3 pt-1">
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="pt-10">
        <EmptyState
          icon={<CalendarDays />}
          title="No cleanings yet"
          description="When you request a cleaning, it will show up here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-1">
      {sections.map((section) => (
        <section key={section.key}>
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <h2 className="text-sm font-bold">{section.label}</h2>
            <span className="ml-auto text-xs font-medium text-muted-foreground">
              {section.appointments.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {section.appointments.map((a: Appointment) => (
              <CleaningRow key={a.id} appointment={a} onClick={() => onOpen(a.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
