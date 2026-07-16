'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { getAccessToken } from '@/lib/auth/clientAccessToken';

interface DeleteOrgDialogProps {
  open: boolean;
  orgId: string;
  orgName: string;
  memberCount: number;
  appointmentCount: number;
  stripeConnected: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

type Stage = 'confirm-name' | 'final-confirm' | 'deleting';

/**
 * Two-step destructive confirmation for platform-admin "delete tenant".
 *
 * Step 1 (confirm-name): User must type the exact org name. The button is
 * disabled until it matches — a Slack-style guard against muscle memory.
 *
 * Step 2 (final-confirm): A 3-second countdown disables the final button.
 * Removes the "click through anything" failure mode where a user types the
 * name out of habit and clicks again on momentum.
 */
export default function DeleteOrgDialog({
  open,
  orgId,
  orgName,
  memberCount,
  appointmentCount,
  stripeConnected,
  onClose,
  onDeleted,
}: DeleteOrgDialogProps) {
  useBodyScrollLock(open);

  const [stage, setStage] = useState<Stage>('confirm-name');
  const [typed, setTyped] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setStage('confirm-name');
      setTyped('');
      setCountdown(3);
      setError(null);
    }
  }, [open]);

  // Countdown when we hit final-confirm.
  useEffect(() => {
    if (stage !== 'final-confirm') return;
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, countdown]);

  if (!open) return null;

  const nameMatches = typed.trim() === orgName.trim() && typed.trim().length > 0;

  async function handleFinalDelete() {
    setStage('deleting');
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/platform/organizations/${orgId}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(data.error || `Delete failed with status ${res.status}`);
      }
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setStage('final-confirm');
      setCountdown(0); // user can retry immediately
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={stage === 'deleting' ? undefined : onClose}
      />
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-labelledby="delete-org-title"
          aria-modal="true"
          className="relative max-w-lg w-full overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-up"
        >
          {stage !== 'deleting' && (
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          <div className="border-b border-red-200 bg-red-50 px-6 py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-red-600" />
              <h2 id="delete-org-title" className="text-lg font-bold text-red-900">
                Delete {orgName}
              </h2>
            </div>
          </div>

          {stage === 'confirm-name' && (
            <div className="px-6 py-5">
              <p className="mb-3 text-sm text-gray-700">
                This will permanently delete the tenant and everything tied to it:
              </p>
              <ul className="mb-4 space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <li>
                  <span className="font-semibold">{memberCount}</span> member
                  {memberCount === 1 ? '' : 's'} (users that belong to this org only will be
                  deleted; users in other orgs will be detached)
                </li>
                <li>
                  <span className="font-semibold">{appointmentCount}</span> appointment
                  {appointmentCount === 1 ? '' : 's'}, plus all properties, services, messages, and
                  payment history
                </li>
                {stripeConnected && (
                  <li>The connected Stripe account will be deactivated</li>
                )}
                <li className="text-red-700">This cannot be undone.</li>
              </ul>
              <label htmlFor="confirm-name-input" className="mb-1 block text-sm font-medium text-gray-700">
                Type <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-900">{orgName}</span> to continue
              </label>
              <input
                id="confirm-name-input"
                type="text"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-red-500 focus:ring-2 focus:ring-red-500"
              />
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStage('final-confirm');
                    setCountdown(3);
                  }}
                  disabled={!nameMatches}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {stage === 'final-confirm' && (
            <div className="px-6 py-5">
              <p className="mb-4 text-sm text-gray-700">
                Are you absolutely sure? Deleting{' '}
                <span className="font-semibold">{orgName}</span> is permanent: there is no undo,
                no restore, and no audit-log reversal.
              </p>
              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStage('confirm-name')}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleFinalDelete}
                  disabled={countdown > 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {countdown > 0 ? `Delete forever (${countdown})` : 'Delete forever'}
                </button>
              </div>
            </div>
          )}

          {stage === 'deleting' && (
            <div className="flex items-center gap-3 px-6 py-8 text-sm text-gray-700">
              <Loader2 className="h-5 w-5 animate-spin text-red-600" />
              Deleting {orgName}. This can take a few seconds…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
