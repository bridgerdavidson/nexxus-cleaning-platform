'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { User, OrgRole, Organization } from '../types';

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
  // #region agent log
  const hookInstanceId = useRef(Math.random().toString(36).substring(7));
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:27',message:'useAuth hook mounted',data:{instanceId:hookInstanceId.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    return () => {
      if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:27',message:'useAuth hook unmounted',data:{instanceId:hookInstanceId.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    };
  }, []);
  // #endregion
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(null);
  const [currentOrgRole, setCurrentOrgRole] = useState<OrgRole | null>(null);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const isSigningOutRef = useRef(false);
  const isSigningInRef = useRef(false);
  const userRef = useRef<User | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastSignOutTimeRef = useRef<number>(0);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCleaningUpRef = useRef(false);
  
  // Keep refs in sync with state
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  
  useEffect(() => {
    isCleaningUpRef.current = isCleaningUp;
  }, [isCleaningUp]);

  const loadUserProfile = useCallback(async (supabaseUser: SupabaseUser) => {
    // Early exit if signing out - don't waste time on queries or warnings
    if (isSigningOutRef.current) {
      return;
    }

    const callId = Math.random().toString(36).substring(7);

    // Helper functions (defined inside callback to avoid dependency issues)
    const getRoleFromAuth = (user: SupabaseUser): User['role'] => {
      return (
        (user.app_metadata?.role as User['role']) ||
        (user.user_metadata?.role as User['role']) ||
        'homeowner'
      );
    };

    const buildUserFromAuthOnly = (user: SupabaseUser): User => {
      const role = getRoleFromAuth(user);

      return {
        id: user.id,
        email: user.email || '',
        role,
        profile: {
          firstName: ((user.user_metadata?.firstName || user.user_metadata?.first_name) as string) || '',
          lastName: ((user.user_metadata?.lastName || user.user_metadata?.last_name) as string) || '',
          phone: (user.user_metadata?.phone as string) || '',
          avatarUrl: undefined,
        },
        createdAt: user.created_at,
        updatedAt: user.created_at,
      };
    };

    try {
      // Retry logic for 406 errors (session token may not be ready immediately)
      interface ProfileData {
        id: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        role: string;
        avatar_url: string | null;
        updated_at: string;
      }
      let profileResult: { data: ProfileData | null; error: { code?: string; status?: number; message?: string } | null } | null = null;
      let retryCount = 0;
      const maxRetries = 1; // Retry once for 406 errors

      while (retryCount <= maxRetries) {
        // Check if signing out before starting query
        if (isSigningOutRef.current) {
          return;
        }

        // Create new AbortController for this query attempt
        const ac = new AbortController();
        abortControllerRef.current = ac; // Allow signOut to cancel in-flight loads
        const timeoutId = setTimeout(() => ac.abort(), 5000);

        // Create profile query
        const profileQuery = supabase
          .from('user_profiles')
          .select('*')
          .eq('id', supabaseUser.id)
          .single();

        // Create promise that rejects when aborted
        const abortPromise = new Promise<never>((_, reject) => {
          ac.signal.addEventListener('abort', () => {
            reject(new Error('Profile query aborted'));
          });
        });

        try {
          // Race between query and abort signal
          profileResult = await Promise.race([profileQuery, abortPromise]);
          
          clearTimeout(timeoutId);
          abortControllerRef.current = null; // Clear ref on completion
          
          // Check again if signing out after query completes
          if (isSigningOutRef.current) {
            return;
          }
        } catch (err) {
          clearTimeout(timeoutId);
          abortControllerRef.current = null; // Clear ref on error
          
          // Check again if signing out before logging warning
          if (isSigningOutRef.current) {
            return;
          }
          
          // Only log "timed out" if the signal was actually aborted
          // (Logging removed)
          
          const userData = buildUserFromAuthOnly(supabaseUser);
          if (!isSigningOutRef.current) setUser(userData);
          return;
        }

        // Check if query returned an error
        if (profileResult.error) {
          // Check if signing out before processing error
          if (isSigningOutRef.current) {
            return;
          }

          const error = profileResult.error;
          // Handle PGRST116 (no profile row found) or 406 (Not Acceptable - RLS blocking)
          // 406 often occurs when session token isn't fully propagated yet after sign in
          const isProfileNotFound = error.code === 'PGRST116';
          const errorStatus = 'status' in error ? (error as { status?: number }).status : undefined;
          const errorMessage = 'message' in error ? (error as { message?: string }).message : undefined;
          const isNotAcceptable = errorStatus === 406 || 
                                  errorMessage?.includes('406') ||
                                  String(error).includes('406');
          
          if (isProfileNotFound) {
            // No profile exists - don't retry
            const userData = buildUserFromAuthOnly(supabaseUser);
            if (!isSigningOutRef.current) setUser(userData);
            return;
          }

          if (isNotAcceptable && retryCount < maxRetries) {
            // 406 error - retry once after a short delay
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Check again if signing out before retry
            if (isSigningOutRef.current) {
              return;
            }
            continue; // Retry the query
          }

          // 406 on last retry or other error - fall back to auth metadata
          const userData = buildUserFromAuthOnly(supabaseUser);
          if (!isSigningOutRef.current) setUser(userData);
          return;
        }

        // Success - break out of retry loop
        break;
      }

      // Final check before setting user state
      if (isSigningOutRef.current) {
        return;
      }

      // If we get here, profileResult should have data
      if (!profileResult || profileResult.error || !profileResult.data) {
        // This shouldn't happen, but handle it anyway
        const userData = buildUserFromAuthOnly(supabaseUser);
        if (!isSigningOutRef.current) setUser(userData);
        return;
      }

      const profile = profileResult.data;

      const userData: User = {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        role: (profile.role as User['role']) || getRoleFromAuth(supabaseUser),
        profile: {
          firstName: profile.first_name || '',
          lastName: profile.last_name || '',
          phone: profile.phone || '',
          avatarUrl: profile.avatar_url || undefined,
        },
        createdAt: supabaseUser.created_at,
        updatedAt: profile.updated_at || supabaseUser.created_at,
      };

      if (!isSigningOutRef.current) setUser(userData);
    } catch (err) {
      // Always fall back to auth metadata - never leave user as null if we have a session
      // This ensures sign-in can complete even if profile loading fails
      const userData = buildUserFromAuthOnly(supabaseUser);
      if (!isSigningOutRef.current) setUser(userData);
    }
  }, []);

  // Load organization membership after user is loaded
  useEffect(() => {
    if (!user) {
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      return;
    }

    const loadOrganization = async () => {
      try {
        const { data, error } = await supabase
          .from('organization_members')
          .select('organization_id, role, organizations ( id, name, logo_url )')
          .eq('user_id', user.id)
          .limit(1);

        if (error) {
          setCurrentOrganizationId(null);
          setCurrentOrgRole(null);
          setCurrentOrganization(null);
          return;
        }

        if (!data || data.length === 0) {
          setCurrentOrganizationId(null);
          setCurrentOrgRole(null);
          setCurrentOrganization(null);
          return;
        }

        const membership = data[0];
        const orgData = membership.organizations as { id: string; name: string; logo_url: string | null } | { id: string; name: string; logo_url: string | null }[] | null;
        const org = Array.isArray(orgData) ? orgData[0] : orgData;
        
        setCurrentOrganizationId(membership.organization_id);
        setCurrentOrgRole(membership.role as OrgRole);
        if (org) {
          setCurrentOrganization({
            id: org.id,
            name: org.name,
            logo_url: org.logo_url || undefined,
            created_at: new Date().toISOString(), // We don't have this from the query, use current time as fallback
            created_by: null,
          });
        } else {
          setCurrentOrganization(null);
        }
      } catch (err) {
        setCurrentOrganizationId(null);
        setCurrentOrgRole(null);
        setCurrentOrganization(null);
      }
    };

    loadOrganization();
  }, [user]);

  useEffect(() => {
    // #region agent log
    if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:320',message:'Main useEffect running',data:{instanceId:hookInstanceId.current,hasLoadUserProfile:!!loadUserProfile},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    let isMounted = true;
  
    const init = async () => {
      // #region agent log
      if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:325',message:'init() called',data:{instanceId:hookInstanceId.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      try {
        const { data, error } = await supabase.auth.getSession();
  
        if (!isMounted) return;

        if (error) {
          setSession(null);
          setUser(null);
          return;
        }
  
        const session = data.session;
        setSession(session);
  
        if (session?.user) {
          // #region agent log
          if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:340',message:'init calling loadUserProfile',data:{instanceId:hookInstanceId.current,userId:session.user.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          
          // 🔹 We DO await here so the initial "loading" covers profile fetch
          await loadUserProfile(session.user);
        } else {
          // no session → definitely logged out
          setUser(null);
        }
      } catch (err) {
        if (!isMounted) return;
        setSession(null);
        setUser(null);
      } finally {
        // 🔹 IMPORTANT: this runs for both "has session" and "no session" paths
        if (isMounted) {
          setLoading(false);
        }
      }
    };
  
    const initPromise = init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // #region agent log
      if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:365',message:'onAuthStateChange fired',data:{instanceId:hookInstanceId.current,event,userId:session?.user?.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      if (!isMounted) return;
  
      // Handle SIGNED_OUT event explicitly
      if (event === 'SIGNED_OUT' || !session) {
        setSession(null);
        setUser(null);
        setCurrentOrganizationId(null);
        setCurrentOrgRole(null);
        setCurrentOrganization(null);
        setLoading(false);
        isSigningInRef.current = false; // Reset sign-in flag if sign out happens
        return;
      }
  
      // Handle SIGNED_IN event - ensure we're not interfering
      if (event === 'SIGNED_IN' && session?.user) {
        isSigningInRef.current = true; // Set flag during sign-in process
        
        // Clear cleanup state immediately on successful sign-in
        if (isCleaningUpRef.current) {
          if (cleanupTimeoutRef.current) {
            clearTimeout(cleanupTimeoutRef.current);
            cleanupTimeoutRef.current = null;
          }
          setIsCleaningUp(false);
        }
        
        // Check if sign out was recent (< 3 seconds ago)
        // If so, increase delay to give more time for cleanup and session propagation
        const timeSinceSignOut = Date.now() - lastSignOutTimeRef.current;
        const delay = timeSinceSignOut < 3000 ? 500 : 200;
        
        // Small delay to allow Supabase session token to propagate
        // This prevents 406 errors from RLS blocking queries too early
        // Longer delay if sign out was recent to allow pending queries to complete
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      setSession(session);

      if (session?.user) {
        // Don't load profile if we're signing out
        if (isSigningOutRef.current) {
          return;
        }

        // #region agent log
        if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:410',message:'onAuthStateChange calling loadUserProfile',data:{instanceId:hookInstanceId.current,event,userId:session.user.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
        // #endregion

        // 🔹 Auth state changes (sign in / token refresh) update the user,
        // but we DO NOT touch `loading` here
        try {
          await loadUserProfile(session.user);
          // loadUserProfile always sets user (either from profile or auth metadata)
          // so user state should be set at this point
        } catch (err) {
          // loadUserProfile should have already set user from auth metadata as fallback in its catch block
          // If for some reason it didn't, loadUserProfile will be called again or user will be set
          // The important thing is we don't leave user as null if we have a session
        } finally {
          // Always reset sign-in flag after profile loading attempt completes
          if (event === 'SIGNED_IN') {
            isSigningInRef.current = false;
          }
        }
      } else {
        // No user in session - clear state
        setUser(null);
        isSigningInRef.current = false;
      }
    });

    // Handle tab visibility changes - refresh session when tab becomes visible
    // This ensures Supabase client is in sync after tab switching
    // Only runs after initial load completes and with proper guards
    let lastVisibilityCheck = 0;
    let initialLoadComplete = false;
    
    const handleVisibilityChange = async () => {
      // Simple, bulletproof checks - if any fail, don't run
      if (!isMounted || !initialLoadComplete) return;
      if (isSigningOutRef.current || isSigningInRef.current) return;
      if (!userRef.current) return; // No user = we're on login/signup or signed out
      
      // Don't refresh if we're on login/signup pages (extra safety check)
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (path === '/login' || path.startsWith('/signup')) {
          return;
        }
      }
      
      // Debounce visibility checks (max once per 2 seconds)
      const now = Date.now();
      if (now - lastVisibilityCheck < 2000) return;
      lastVisibilityCheck = now;
      
      // Only refresh if tab becomes visible
      if (document.visibilityState === 'visible') {
        try {
          // Get current session directly from Supabase (avoids stale closure)
          const { data, error } = await supabase.auth.getSession();
          
          // Double-check flags after async operation
          if (!isMounted || isSigningOutRef.current || isSigningInRef.current) return;
          if (!userRef.current) return; // User might have signed out during async call
          
          if (error) {
            // Silently fail - don't interfere with normal flow
            return;
          }
          
          // Only refresh if session exists and matches current user
          if (data.session && data.session.user.id === userRef.current.id) {
            // onAuthStateChange will handle user profile reload if needed
            // Just ensure session is in sync
            setSession(data.session);
          }
          // Don't clear session here - let onAuthStateChange handle it
        } catch {
          // Silently fail - don't interfere with normal flow
        }
      }
    };

    // Mark initial load as complete after init finishes
    initPromise.finally(() => {
      if (isMounted) {
        initialLoadComplete = true;
        // Only enable visibility handler after initial load completes
        // Use a small delay to avoid sign-in interference
        setTimeout(() => {
          if (isMounted) {
            document.addEventListener('visibilitychange', handleVisibilityChange);
          }
        }, 2000);
      }
    });

    return () => {
      // #region agent log
      if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useAuth.ts:505',message:'Main useEffect cleanup',data:{instanceId:hookInstanceId.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      isMounted = false;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps: run once on mount, loadUserProfile is memoized and stable
  

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    try {
      // Prevent sign-in if we're still cleaning up from sign out
      // This prevents "No API key found" errors when signing in too quickly
      if (isCleaningUpRef.current) {
        return { error: 'Please wait a moment before signing in again' };
      }
      
      // Set flag to prevent visibility handler from interfering
      isSigningInRef.current = true;
      
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
  
      if (signInError) {
        isSigningInRef.current = false;
        return { error: signInError.message };
      }
  
      if (data.session) {
        setSession(data.session);
        
        // Clear cleanup state immediately on successful sign-in
        if (isCleaningUpRef.current) {
          if (cleanupTimeoutRef.current) {
            clearTimeout(cleanupTimeoutRef.current);
            cleanupTimeoutRef.current = null;
          }
          setIsCleaningUp(false);
        }
        
        // onAuthStateChange + loadUserProfile will run next
        // Reset flag after a short delay to allow onAuthStateChange to process
        setTimeout(() => {
          isSigningInRef.current = false;
        }, 1000);
      } else {
        isSigningInRef.current = false;
      }
  
      return {};
    } catch (error) {
      isSigningInRef.current = false;
      return { error: 'An unexpected error occurred' };
    }
  };
  
  
  

  const signUp = async (
    email: string,
    password: string,
    userData: { firstName: string; lastName: string; role: string }
  ): Promise<{ error?: string; role?: string }> => {
    try {
      // Helper function to fetch with timeout
      const fetchWithTimeout = async (url: string, options: RequestInit, timeout = 30000) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      };

      // Retry logic for cold start issues
      let lastError: Error | null = null;
      const maxRetries = 2;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Call secure API route that uses admin client to set app_metadata
          // Use longer timeout on first attempt (cold start), shorter on retries
          const timeout = attempt === 0 ? 30000 : 15000;
          const response = await fetchWithTimeout('/api/auth/signup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email,
              password,
              firstName: userData.firstName,
              lastName: userData.lastName,
              role: userData.role,
            }),
          }, timeout);

          const result = await response.json();

          if (!response.ok) {
            setLoading(false);
            return { error: result.error || 'Signup failed' };
          }

          // Automatically sign in the user after successful signup
          const signInResult = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (signInResult.error) {
            // Signup succeeded but auto sign-in failed - user can manually log in
            return { error: 'Account created. Please log in.' };
          }

          if (signInResult.data.session) {
            setSession(signInResult.data.session);
            // Loading state will be managed by onAuthStateChange -> loadUserProfile
          }

          // Return the role so the signup page can redirect appropriately
          return { role: userData.role };
        } catch (error) {
          lastError = error as Error;
          
          // If it's an abort error (timeout) and we have retries left, try again
          if (error instanceof Error && error.name === 'AbortError' && attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            continue;
          }
          
          // If it's not a timeout or we're out of retries, throw
          throw error;
        }
      }
      
      // If we get here, all retries failed
      throw lastError || new Error('All signup attempts failed');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: 'Request timed out. Please try again.' };
      }
      return { error: error instanceof Error ? error.message : 'An unexpected error occurred' };
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      // Set flag to prevent visibility handler from interfering
      isSigningOutRef.current = true;
      // Also reset sign-in flag in case it was stuck
      isSigningInRef.current = false;
      
      // Track sign out timestamp for delay calculation on next sign in
      lastSignOutTimeRef.current = Date.now();
      
      // Abort any pending profile queries
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      // Clear local state immediately for responsive UI
      setUser(null);
      setSession(null);
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      setLoading(false); // Ensure loading state is cleared

      // Sign out via Supabase with global scope to clear server session
      // This prevents session from reappearing on refresh
      const signOutPromise = supabase.auth.signOut(); // Default is global scope
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Sign out timeout')), 5000)
      );

      try {
        await Promise.race([signOutPromise, timeoutPromise]);
        // onAuthStateChange will fire with SIGNED_OUT event and clear state
      } catch (err) {
        // If signOut fails or times out, we still cleared local state above
        // This ensures logout always works even if Supabase is unresponsive
      } finally {
        // Reset flags after sign out completes
        isSigningOutRef.current = false;
        isSigningInRef.current = false;
        
        // Clear any existing cleanup timeout
        if (cleanupTimeoutRef.current) {
          clearTimeout(cleanupTimeoutRef.current);
          cleanupTimeoutRef.current = null;
        }
        
        // Set cleanup state to prevent sign-in until Supabase client resets
        // This prevents "No API key found" errors when signing in too quickly
        setIsCleaningUp(true);
        
        // Clear cleanup state after 1.5 seconds (enough for client reset)
        cleanupTimeoutRef.current = setTimeout(() => {
          setIsCleaningUp(false);
          cleanupTimeoutRef.current = null;
        }, 1500);
      }
    } catch (err) {
      // Ensure local state is cleared even if something unexpected happens
      setUser(null);
      setSession(null);
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      setLoading(false);
      isSigningOutRef.current = false;
      isSigningInRef.current = false;
    }
  };
  
  
  

  const updateProfile = async (updates: Partial<User['profile']>): Promise<{ error?: string }> => {
    if (!user) return { error: 'No user logged in' };

    try {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          first_name: updates.firstName,
          last_name: updates.lastName,
          phone: updates.phone,
        })
        .eq('id', user.id);

      if (updateError) {
        return { error: updateError.message };
      }

      // Update local user state
      setUser(prev => prev ? {
        ...prev,
        profile: { ...prev.profile, ...updates },
        updatedAt: new Date().toISOString(),
      } : null);

      return {};
    } catch {
      return { error: 'An unexpected error occurred' };
    }
  };

  const accessToken = session?.access_token || null;

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
    };
  }, []);

  return {
    user,
    loading,
    session,
    signIn,
    signUp,
    signOut,
    updateProfile,
    accessToken,
    isCleaningUp,
    currentOrganizationId,
    currentOrgRole,
    currentOrganization,
  };
}
