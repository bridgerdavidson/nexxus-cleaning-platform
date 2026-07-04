'use client';

import { useState } from 'react';
import type { HomeownerRequest } from '@/hooks/useHomeownerRequests';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';

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
  const slots = request.requested_slots.length;
  const location = request.property?.address ?? request.property?.name ?? 'Your home';
  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {request.service_type?.name ?? 'Cleaning'} request
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {location} · {slots} preferred {slots === 1 ? 'time' : 'times'}
          </p>
        </div>
        <Badge variant="caution">Awaiting</Badge>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] text-critical-700 hover:text-critical-700"
          onClick={() => setOpen(true)}
        >
          Cancel request
        </Button>
      </div>
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
          try {
            await onCancel(request.id);
            setOpen(false);
          } catch {
            toast.error('Could not cancel the request. Please try again.');
          }
        }}
      />
    </div>
  );
}
