'use client';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { OperatorBookingForm } from './OperatorBookingForm';

/**
 * The operator new-booking container: a right-anchored Sheet (slide-over on desktop, full-screen on
 * mobile , the BookingDetailSheet pattern). The form is rendered as a child of SheetContent so it
 * mounts fresh each open (fresh state) and its data hooks only run while the sheet is open.
 */
export function OperatorBookingSheet({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill?: { date?: string; time?: string };
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <OperatorBookingForm prefill={prefill} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
