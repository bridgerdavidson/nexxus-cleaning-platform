'use client';

import { useState } from 'react';
import type { HomeownerRequest } from '@/hooks/useHomeownerRequests';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function PendingRequestCard({
  request,
  onCancel,
  cancelling,
}: {
  request: HomeownerRequest;
  onCancel: (id: string) => Promise<void>;
  cancelling: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">
          {request.service_type?.name ?? 'Cleaning'} request
        </p>
        <Badge variant="caution">Awaiting</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {request.property?.address ?? request.property?.name ?? 'Your home'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {request.requested_slots.length} preferred{' '}
        {request.requested_slots.length === 1 ? 'time' : 'times'} sent
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 min-h-[44px] text-critical-700 hover:text-critical-700"
        onClick={() => setOpen(true)}
      >
        Cancel request
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this request?"
        description="This withdraws your cleaning request. You can always request a new one."
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        destructive
        loading={cancelling}
        onConfirm={async () => {
          await onCancel(request.id);
          setOpen(false);
        }}
      />
    </div>
  );
}
