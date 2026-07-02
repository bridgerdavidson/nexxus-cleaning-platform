'use client';

import { ChevronLeft } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';

/**
 * TEMPORARY SHELL (Task 1). Replaced by the full container in Task 8. For now it just
 * proves the opener/host wiring: any "Request a cleaning" entry opens this full-screen
 * takeover and the close button clears the booking params.
 */
export function BookingFlow({
  initialServiceTypeId,
  initialPropertyId,
  onClose,
}: {
  initialServiceTypeId: string | null;
  initialPropertyId: string | null;
  onClose: () => void;
}) {
  return (
    <MobileTakeover ariaLabel="Request a cleaning" keyboardAware onClosed={onClose}>
      {(close) => (
        <>
          <div className="flex items-center gap-2 border-b border-border px-2">
            <button
              onClick={close}
              aria-label="Close"
              className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-6" />
            </button>
            <div className="min-w-0 flex-1 py-2">
              <div className="truncate text-sm font-bold">Request a cleaning</div>
            </div>
            <div className="w-1" />
          </div>
          <div className="flex-1 overflow-y-auto p-5 text-sm text-muted-foreground">
            Booking flow coming together. (prefill service: {initialServiceTypeId ?? 'none'}, property:{' '}
            {initialPropertyId ?? 'none'})
          </div>
        </>
      )}
    </MobileTakeover>
  );
}
