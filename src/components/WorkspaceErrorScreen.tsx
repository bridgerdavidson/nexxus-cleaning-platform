'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Full-screen fallback shown when the org context fails to load (orgStatus ===
 * 'error'). Previously a transient org-load failure silently disabled every
 * data query and left a blank dashboard with no way to recover short of a hard
 * reload; this surfaces the failure and offers an in-place retry that re-runs
 * loadOrganization (no full page reload, so the session is preserved).
 */
export default function WorkspaceErrorScreen({
  onRetry,
}: {
  onRetry: () => void | Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-screen bg-white md:bg-gray-100 flex items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Couldn&apos;t load your workspace
        </h2>
        <p className="mb-6 text-sm text-gray-600">
          We hit a snag loading your account. This is usually temporary. You&apos;re still
          signed in.
        </p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-60"
        >
          {retrying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    </div>
  );
}
