'use client';

import { CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function SetupCompleteCard({
  title = "You're all set",
  description = 'Your setup is complete. This hides on your next visit.',
  onDismiss,
}: {
  title?: string;
  description?: string;
  onDismiss: () => void;
}) {
  return (
    <Card className="flex items-center gap-4 p-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-pill bg-positive text-white">
        <CheckCircle2 className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-extrabold tracking-tight text-foreground">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onDismiss}>
        Dismiss
      </Button>
    </Card>
  );
}
