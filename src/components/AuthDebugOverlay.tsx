'use client';

import { useAuth } from '../hooks/useAuth';
import { AUTH_DEBUG, tokenTail } from '../lib/authDebug';

/**
 * Flag-gated (NEXT_PUBLIC_AUTH_DEBUG === 'true') corner badge that shows the
 * live auth/org state. Lets a tester on a second device SEE which field is wrong
 * on the blank screen (e.g. orgStatus stuck on 'error', or org id null) without
 * needing devtools open on that machine. Renders null when the flag is off, so
 * it's safe to leave mounted in production.
 */
export default function AuthDebugOverlay() {
  const { user, accessToken, currentOrganizationId, orgStatus, isPlatformAdmin } = useAuth();

  if (!AUTH_DEBUG) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.85)',
        color: '#0f0',
        font: '11px/1.4 ui-monospace, monospace',
        padding: '6px 8px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {[
        `user: ${user ? user.id.slice(0, 8) : 'null'}`,
        `orgStatus: ${orgStatus}`,
        `orgId: ${currentOrganizationId ? currentOrganizationId.slice(0, 8) : 'null'}`,
        `token: ${tokenTail(accessToken)}`,
        `platformAdmin: ${String(isPlatformAdmin)}`,
      ].join('\n')}
    </div>
  );
}
