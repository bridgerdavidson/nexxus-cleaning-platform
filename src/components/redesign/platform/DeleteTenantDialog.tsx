'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

type Stage = 'confirm-name' | 'final-confirm' | 'deleting';

/**
 * Two-step destructive confirm for deleting a tenant: type the exact org name to
 * enable Continue, then a 3-second countdown gates the final delete. Preserves
 * the legacy DeleteOrgDialog behavior, rebuilt on ui/dialog.
 */
export function DeleteTenantDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  memberCount,
  appointmentCount,
  stripeConnected,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
  memberCount: number;
  appointmentCount: number;
  stripeConnected: boolean;
  onDeleted: () => void;
}) {
  const [stage, setStage] = useState<Stage>('confirm-name');
  const [typed, setTyped] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStage('confirm-name');
      setTyped('');
      setCountdown(3);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (stage !== 'final-confirm' || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, countdown]);

  const nameMatches = typed.trim() === orgName.trim() && typed.trim().length > 0;

  async function handleDelete() {
    setStage('deleting');
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/platform/organizations/${orgId}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
      setStage('final-confirm');
      setCountdown(0); // allow immediate retry
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (stage === 'deleting') return; // don't allow closing mid-delete
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" aria-hidden />
            Delete {orgName}
          </DialogTitle>
          <DialogDescription>
            {stage === 'confirm-name'
              ? 'This permanently deletes the tenant and everything tied to it. This cannot be undone.'
              : stage === 'final-confirm'
                ? 'Last check. This is permanent, with no undo, restore, or audit-log reversal.'
                : `Deleting ${orgName}. This can take a few seconds.`}
          </DialogDescription>
        </DialogHeader>

        {stage === 'confirm-name' ? (
          <div className="mt-2 space-y-4">
            <ul className="space-y-1 rounded-control bg-muted px-4 py-3 text-sm text-muted-foreground">
              <li>
                <span className="font-semibold text-foreground">{memberCount}</span> member
                {memberCount === 1 ? '' : 's'} (org-only users deleted; multi-org users detached)
              </li>
              <li>
                <span className="font-semibold text-foreground">{appointmentCount}</span> appointment
                {appointmentCount === 1 ? '' : 's'}, plus properties, services, messages, and payment
                history
              </li>
              {stripeConnected ? <li>The connected Stripe account will be deactivated</li> : null}
            </ul>
            <div className="space-y-2">
              <label htmlFor="delete-confirm-name" className="text-sm font-medium text-foreground">
                Type the organization name to continue
              </label>
              <Input
                id="delete-confirm-name"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={orgName}
              />
            </div>
          </div>
        ) : null}

        {stage === 'final-confirm' && error ? (
          <p
            role="alert"
            className="mt-2 rounded-control border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="mt-6 gap-2">
          {stage === 'confirm-name' ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!nameMatches}
                onClick={() => {
                  setStage('final-confirm');
                  setCountdown(3);
                }}
              >
                Continue
              </Button>
            </>
          ) : stage === 'final-confirm' ? (
            <>
              <Button variant="ghost" onClick={() => setStage('confirm-name')}>
                Back
              </Button>
              <Button
                variant="destructive"
                disabled={countdown > 0}
                onClick={() => void handleDelete()}
              >
                <Trash2 />
                {countdown > 0 ? `Delete forever (${countdown})` : 'Delete forever'}
              </Button>
            </>
          ) : (
            <Button variant="destructive" loading disabled>
              Deleting...
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
