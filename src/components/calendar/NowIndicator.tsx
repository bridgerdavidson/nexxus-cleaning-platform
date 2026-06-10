/**
 * The red "now" line drawn across a time-grid column for today. Updates each minute. Renders
 * nothing when the current time is outside the visible window. Parent only mounts it for the
 * column whose date is today.
 */
'use client';
import React, { useEffect, useState } from 'react';
import { minutesToY } from '@/lib/calendar/timeGrid';
import type { BusinessHours } from '@/lib/calendar/types';

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export default function NowIndicator({ hours }: { hours: BusinessHours }) {
  const [min, setMin] = useState<number>(() => nowMinutes());

  useEffect(() => {
    const id = setInterval(() => setMin(nowMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (min < hours.startMin || min > hours.endMin) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top: minutesToY(min, hours.startMin) }}
      aria-hidden="true"
    >
      <div className="relative border-t-2 border-red-500">
        <span className="absolute -left-[3px] -top-[5px] h-2 w-2 rounded-full bg-red-500" />
      </div>
    </div>
  );
}
