'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Appointment } from '@/hooks/useHomeownerData';
import { Progress } from '@/components/ui/progress';
import { useJobChecklistProgress } from '@/hooks/useJobChecklistProgress';
import { useHomeownerJobPhotos } from '@/hooks/useHomeownerJobPhotos';
import { checklistProgressLabel } from '@/components/redesign/cleaner/job/active-job-presenters';
import { cn } from '@/lib/utils';
import { progressPercent, formatElapsed, stageLabel } from './job-progress-presenters';

/** `expandable` gates the collapsed-by-default task list. It must stay false
 *  when this renders inside the Home hero, which is itself a <button> (a
 *  nested toggle would be invalid HTML); there the bar + count summarize and
 *  the card tap opens the detail, whose static hero passes expandable. */
export function LiveCleaningProgress({
  appointment,
  expandable = false,
}: {
  appointment: Appointment;
  expandable?: boolean;
}) {
  const { lineItems, completed, doneCount, totalCount } = useJobChecklistProgress({
    appointmentId: appointment.id,
    checklistId: appointment.checklist_id ?? null,
    serviceTypeId: appointment.service_type_id ?? null,
  });
  const [showTasks, setShowTasks] = useState(false);
  const { beforePhotos } = useHomeownerJobPhotos(appointment.id);
  const pct = progressPercent(doneCount, totalCount);
  // Tick every 30s so the elapsed label counts up live. formatElapsed rounds to
  // whole minutes, so a sub-minute cadence is enough to stay current without a
  // per-second re-render. Without this the Date.now() snapshot froze at mount.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const elapsed = useMemo(
    () => formatElapsed(appointment.started_at ?? null, nowMs),
    [appointment.started_at, nowMs],
  );

  return (
    <div className="mt-3 border-t border-white/20 pt-3">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span>{stageLabel(appointment.job_progress)}</span>
        {elapsed && <span className="tabular-nums text-white/85">{elapsed}</span>}
      </div>
      {totalCount > 0 && (
        <>
          <Progress
            value={pct}
            aria-label={checklistProgressLabel(doneCount, totalCount)}
            className="mt-2 bg-white/25"
            barClassName="bg-white"
          />
          <p className="mt-1 text-xs text-white/85 tabular-nums">
            {checklistProgressLabel(doneCount, totalCount)}
          </p>
          {expandable && (
            <button
              type="button"
              aria-expanded={showTasks}
              onClick={() => setShowTasks((v) => !v)}
              className="mt-1 flex min-h-[44px] w-full items-center justify-between rounded-control text-xs font-semibold text-white/90 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {showTasks ? 'Hide tasks' : 'See tasks'}
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-base',
                  showTasks && 'rotate-180',
                )}
                aria-hidden
              />
            </button>
          )}
          {expandable && showTasks && (
          <ul role="list" className="mt-1 space-y-1.5">
            {lineItems.map((item) => {
              const done = completed.has(item.id);
              return (
                <li key={item.id} className="flex items-start gap-2 text-xs">
                  <span
                    className={cn(
                      'mt-px flex size-4 flex-none items-center justify-center rounded-full border',
                      done ? 'border-white bg-white/20' : 'border-white/40',
                    )}
                    aria-hidden
                  >
                    {done && <Check className="size-3 text-white" />}
                  </span>
                  <span
                    className={cn(
                      'leading-snug',
                      done ? 'text-white/60 line-through' : 'text-white/90',
                    )}
                  >
                    {item.task}
                  </span>
                  {done && <span className="sr-only">(done)</span>}
                </li>
              );
            })}
          </ul>
          )}
        </>
      )}
      {beforePhotos.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {beforePhotos.slice(0, 3).map((p) => (
            // eslint-disable-next-line @next/next/no-img-element -- public bucket, next/image needs domain config
            <img
              key={p.id}
              src={p.photo_url}
              alt="Before photo"
              className="h-14 w-14 flex-none rounded-control object-cover"
            />
          ))}
        </div>
      )}
    </div>
  );
}
