'use client';

import { useContext } from 'react';
import { Session } from '@supabase/supabase-js';
import { User, OrgRole, Organization } from '../types';
import { AuthContext } from '../contexts/AuthContext';

export interface AuthState {
  user: User | null;
  loading: boolean;
  session: Session | null;
  accessToken: string | null | undefined;
  isCleaningUp: boolean; // True when waiting for Supabase client to reset after sign out
  currentOrganizationId: string | null;
  currentOrgRole: OrgRole | null;
  currentOrganization: Organization | null;
  isPlatformAdmin: boolean | null; // null = not yet resolved (see /api/platform/whoami)
  impersonatingOrgId: string | null; // platform-admin "View as" target, or null
  impersonatingOrgName: string | null;
}

export interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, userData: { firstName: string; lastName: string; role: string }) => Promise<{ error?: string; role?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User['profile']>) => Promise<{ error?: string }>;
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
