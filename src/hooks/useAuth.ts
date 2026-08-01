'use client';

import { useContext } from 'react';
import { Session } from '@supabase/supabase-js';
import { User, OrgRole, Organization } from '../types';
import { AuthContext } from '../contexts/AuthContext';
import type { OrgStatus } from '../lib/orgLoad';

export interface AuthState {
  user: User | null;
  loading: boolean;
  session: Session | null;
  accessToken: string | null | undefined;
  isCleaningUp: boolean; // True when waiting for Supabase client to reset after sign out
  currentOrganizationId: string | null;
  currentOrgRole: OrgRole | null;
  currentOrganization: Organization | null;
  /** Every org the user belongs to, oldest membership first. Drives the
   * settings org switcher, which renders only when there are 2+. */
  availableOrganizations: { id: string; name: string; role: string }[];
  // Lifecycle of the org-context load. Consumers distinguish a transient,
  // retryable failure ('error') from a confirmed absence of membership
  // ('no-org') so a blank dashboard is never shown for a recoverable blip.
  orgStatus: OrgStatus;
  isPlatformAdmin: boolean | null; // null = not yet resolved (see /api/platform/whoami)
  impersonatingOrgId: string | null; // platform-admin "View as" target, or null
  impersonatingOrgName: string | null;
}

export interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, userData: { firstName: string; lastName: string; role: string }) => Promise<{ error?: string; role?: string }>;
  signOut: () => Promise<void>;
  /** Explicit "sign out of all devices" — revokes every session for the account
   * (Supabase global scope). The default signOut is local-scope so logging out
   * on one device no longer kicks a shared account off everywhere. */
  signOutEverywhere: () => Promise<void>;
  /** Re-run the org-context load (e.g. from a "Try again" button after an
   * orgStatus === 'error'). Resolves when the attempt settles. */
  reloadOrganization: () => Promise<void>;
  /** Silently re-read the current org row (name + branding) without cycling
   * orgStatus, so the role shells never unmount behind FullPageLoader. */
  refreshOrganization: () => Promise<void>;
  updateProfile: (updates: Partial<User['profile']>) => Promise<{ error?: string }>;
  /** Remember the chosen org and reload the app into it. Multi-org users only. */
  switchOrganization: (orgId: string) => void;
  /**
   * Platform-admin "View as" a tenant (read-only). Audit-first: returns true
   * only if the audit log was written; false (no state change) on audit failure
   * or for non-admins. Callers must await.
   */
  startImpersonation: (orgId: string, orgName?: string | null) => Promise<boolean>;
  stopImpersonation: () => void;
}

export function useAuth(): AuthState & AuthActions {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
