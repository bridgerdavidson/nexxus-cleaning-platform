import React from "react";

interface AuthShellProps {
  children: React.ReactNode;
  /** Optional pill text under the wordmark (e.g. "Team Invitation", "Reset Password"). */
  badge?: string;
}

/**
 * Shared full-page chrome for auth flows (accept-invite, forgot-password, reset-password).
 * Renders the Nexxus wordmark + optional badge pill, wraps children in a glass card.
 */
export function AuthShell({ children, badge }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-100 flex items-center justify-center px-4 py-12">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-primary-600">
            Nexxus
          </h1>
          {badge && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-white/80 px-3 py-1 text-xs font-semibold text-primary-700 shadow-sm">
              {badge}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/80 px-8 py-8 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
          {children}
        </div>
      </div>
    </div>
  );
}

export default AuthShell;
