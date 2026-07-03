'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/**
 * TEMPORARY SHELL (Slice 1, Task 1). Replaced by the full assembly in Task 9. Proves the
 * responsive container: a right-anchored Sheet that is a slide-over on desktop and full-screen
 * on mobile (the same pattern as BookingDetailSheet).
 */
export function OperatorBookingSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>New booking</SheetTitle>
        </SheetHeader>
        <div className="p-4 text-sm text-muted-foreground">Operator booking flow coming together.</div>
      </SheetContent>
    </Sheet>
  );
}
