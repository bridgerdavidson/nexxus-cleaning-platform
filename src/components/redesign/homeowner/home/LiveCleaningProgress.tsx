'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Appointment } from '@/hooks/useHomeownerData';
import { Progress } from '@/components/ui/progress';
import { useHomeownerJobProgress } from '@/hooks/useHomeownerJobProgress';
import { useHomeownerJobPhotos } from '@/hooks/useHomeownerJobPhotos';
import { checklistProgressLabel } from '@/components/redesign/cleaner/job/active-job-presenters';
import { progressPercent, formatElapsed, stageLabel } from './job-progress-presenters';

export function LiveCleaningProgress({ appointment }: { appointment: Appointment }) {
  const { doneCount, totalCount } = useHomeownerJobProgress(
    appointment.id,
    appointment.checklist_id ?? null,
  );
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
