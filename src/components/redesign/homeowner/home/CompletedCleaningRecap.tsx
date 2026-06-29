'use client';

import type { Appointment } from '@/hooks/useHomeownerData';
import { useHomeownerJobPhotos } from '@/hooks/useHomeownerJobPhotos';
import { useHomeownerJobProgress } from '@/hooks/useHomeownerJobProgress';
import { checklistProgressLabel } from '@/components/redesign/cleaner/job/active-job-presenters';

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function CompletedCleaningRecap({ appointment }: { appointment: Appointment }) {
  const { afterPhotos } = useHomeownerJobPhotos(appointment.id);
  const { doneCount, totalCount } = useHomeownerJobProgress(
    appointment.id,
    appointment.checklist_id ?? null,
  );
  const paid = appointment.payment_status === 'paid';

  return (
    <div className="mt-3 rounded-card border border-border bg-card p-4 shadow-soft-sm">
      {afterPhotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {afterPhotos.slice(0, 4).map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.id}
              src={p.photo_url}
              alt="After photo"
              className="h-20 w-20 flex-none rounded-control object-cover"
            />
          ))}
        </div>
      )}
      {totalCount > 0 && (
        <p className="mt-3 text-sm font-medium text-muted-foreground tabular-nums">
          {checklistProgressLabel(doneCount, totalCount)}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{paid ? 'Paid' : 'Receipt'}</span>
        <span className="text-sm font-semibold tabular-nums">{formatUsd(appointment.total_price)}</span>
      </div>
    </div>
  );
}
