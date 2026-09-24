'use client';

// The homeowner-facing counterpart to a blocked write (ruling R18). Renders inline and
// persists on screen (never a toast, which disappears). Deliberately owns no copy of its own:
// every word comes from bookingUnavailable.ts so a future edit here cannot reintroduce a
// forbidden word without also editing, and re-testing, that file.

import { PhoneCall } from 'lucide-react';
import { BOOKING_UNAVAILABLE_MESSAGE, callToBookLine } from './bookingUnavailable';

export function HomeownerBookingBlockedNotice({ phone }: { phone: string | null }) {
  const phoneLine = callToBookLine(phone);
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-control border border-info/30 bg-info-50 px-3.5 py-3 text-sm text-info-700 dark:bg-info/15 dark:text-info"
    >
      <PhoneCall className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p>{BOOKING_UNAVAILABLE_MESSAGE}</p>
        {phoneLine ? <p className="font-semibold">{phoneLine}</p> : null}
      </div>
    </div>
  );
}
