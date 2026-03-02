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
}

export interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, userData: { firstName: string; lastName: string; role: string }) => Promise<{ error?: string; role?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User['profile']>) => Promise<{ error?: string }>;
}

export function useAuth(): AuthState & AuthActions {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
