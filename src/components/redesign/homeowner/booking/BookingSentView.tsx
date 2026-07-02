'use client';

import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function BookingSentView({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="mb-4 grid size-16 place-items-center rounded-pill bg-positive-50 text-positive-700">
          <CircleCheck className="size-8" aria-hidden />
        </div>
        <h2 className="text-xl font-extrabold text-foreground">Request sent</h2>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          The office will confirm a time and assign your cleaner. You will get a notification when it is
          scheduled.
        </p>
      </div>
      <div className="shrink-0 border-t border-border bg-card px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <Button className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
