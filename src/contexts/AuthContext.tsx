'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { User, OrgRole, Organization } from '../types';
import type { AuthState, AuthActions } from '../hooks/useAuth';
import { authDebug, tokenTail } from '../lib/authDebug';
import {
  type OrgStatus,
  classifyOrgLoadResult,
  isRetryableOutcome,
  resolveTerminalOrgState,
} from '../lib/orgLoad';

export const AuthContext = React.createContext<(AuthState & AuthActions) | null>(null);

const IMPERSONATION_KEY = 'nexxus_impersonation';
const PLATFORM_ADMIN_CACHE_PREFIX = 'nexxus_is_platform_admin:';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string | null>(null);
  const [currentOrgRole, setCurrentOrgRole] = useState<OrgRole | null>(null);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  // Lifecycle of the org-context load. 'error' is a transient/retryable failure
  // (kept distinct from 'no-org') so a recoverable blip never silently disables
  // every org-scoped query and blanks the dashboard.
  const [orgStatus, setOrgStatus] = useState<OrgStatus>('idle');
  // null = not yet checked. Consumers (login routing, /owner) wait on non-null
  // so a real platform admin is never bounced before the check resolves.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | null>(null);
  // Platform-admin "View as" mode. When set, the exposed currentOrganizationId/
  // currentOrgRole are overridden so every org-scoped hook reads the impersonated
  // tenant (allowed by the SELECT-only RLS predicate in migration 069).
  const [impersonation, setImpersonation] = useState<{ orgId: string; orgName: string | null } | null>(null);
  const isSigningOutRef = useRef(false);
  const isSigningInRef = useRef(false);
  const userRef = useRef<User | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastSignOutTimeRef = useRef<number>(0);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCleaningUpRef = useRef(false);
  // Org-load coordination: a sequence guard so a newer load supersedes an older
  // in-flight one, an abort handle, and the latest org id / status read inside
  // the async loader. lastOrgUserId/Token gate the trigger effect so a token
  // refresh only re-loads when not already 'loaded'.
  const orgLoadAbortRef = useRef<AbortController | null>(null);
  const orgLoadSeqRef = useRef(0);
  const currentOrgIdRef = useRef<string | null>(null);
  const orgStatusRef = useRef<OrgStatus>('idle');
  const lastOrgUserIdRef = useRef<string | null>(null);
  const lastOrgTokenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    isCleaningUpRef.current = isCleaningUp;
  }, [isCleaningUp]);

  useEffect(() => {
    currentOrgIdRef.current = currentOrganizationId;
  }, [currentOrganizationId]);

  useEffect(() => {
    orgStatusRef.current = orgStatus;
  }, [orgStatus]);

  const loadUserProfile = useCallback(async (supabaseUser: SupabaseUser) => {
    if (isSigningOutRef.current) return;

    const getRoleFromAuth = (u: SupabaseUser): User['role'] => {
      // Only trust app_metadata.role (server-set). user_metadata is user-controllable
      // via supabase.auth.updateUser({ data }), so it must never influence the role.
      // Fall back to the least-privileged role when app_metadata.role is unavailable.
      return (u.app_metadata?.role as User['role']) || 'homeowner';
    };

    const buildUserFromAuthOnly = (u: SupabaseUser): User => {
      const role = getRoleFromAuth(u);
      return {
        id: u.id,
        email: u.email || '',
        role,
        profile: {
          firstName: ((u.user_metadata?.firstName || u.user_metadata?.first_name) as string) || '',
          lastName: ((u.user_metadata?.lastName || u.user_metadata?.last_name) as string) || '',
          phone: (u.user_metadata?.phone as string) || '',
          avatarUrl: undefined,
        },
        createdAt: u.created_at,
        updatedAt: u.created_at,
      };
    };

    const mergeExistingProfileInto = (userData: User): void => {
      const current = userRef.current;
      if (current?.id !== supabaseUser.id || !current.profile) return;
      if (current.profile.avatarUrl) userData.profile.avatarUrl = current.profile.avatarUrl;
      if (current.profile.firstName) userData.profile.firstName = current.profile.firstName;
      if (current.profile.lastName) userData.profile.lastName = current.profile.lastName;
      if (current.profile.phone !== undefined && current.profile.phone !== null) userData.profile.phone = current.profile.phone;
    };

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
    const maxRetries = 1;

    try {
      while (retryCount <= maxRetries) {
        if (isSigningOutRef.current) return;

        const ac = new AbortController();
        abortControllerRef.current = ac;
        const timeoutId = setTimeout(() => ac.abort(), 5000);

        const profileQuery = supabase
          .from('user_profiles')
          .select('*')
          .eq('id', supabaseUser.id)
          .single();

        const abortPromise = new Promise<never>((_, reject) => {
          ac.signal.addEventListener('abort', () => reject(new Error('Profile query aborted')));
        });

        try {
          profileResult = await Promise.race([profileQuery, abortPromise]);
          clearTimeout(timeoutId);
          abortControllerRef.current = null;
          if (isSigningOutRef.current) return;
        } catch (_err) {
          clearTimeout(timeoutId);
          abortControllerRef.current = null;
          if (isSigningOutRef.current) return;
          const userData = buildUserFromAuthOnly(supabaseUser);
          mergeExistingProfileInto(userData);
          if (!isSigningOutRef.current) setUser(userData);
          return;
        }

        if (profileResult.error) {
          if (isSigningOutRef.current) return;
          const error = profileResult.error;
          const isProfileNotFound = error.code === 'PGRST116';
          const errorStatus = 'status' in error ? (error as { status?: number }).status : undefined;
          const errorMessage = 'message' in error ? (error as { message?: string }).message : undefined;
          const isNotAcceptable = errorStatus === 406 || errorMessage?.includes('406') || String(error).includes('406');

          if (isProfileNotFound) {
            const userData = buildUserFromAuthOnly(supabaseUser);
            mergeExistingProfileInto(userData);
            if (!isSigningOutRef.current) setUser(userData);
            return;
          }

          if (isNotAcceptable && retryCount < maxRetries) {
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 300));
            if (isSigningOutRef.current) return;
            continue;
          }

          const userData = buildUserFromAuthOnly(supabaseUser);
          mergeExistingProfileInto(userData);
          if (!isSigningOutRef.current) setUser(userData);
          return;
        }

        break;
      }

      if (isSigningOutRef.current) return;

      if (!profileResult || profileResult.error || !profileResult.data) {
        const userData = buildUserFromAuthOnly(supabaseUser);
        mergeExistingProfileInto(userData);
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
      const userData = buildUserFromAuthOnly(supabaseUser);
      mergeExistingProfileInto(userData);
      if (!isSigningOutRef.current) setUser(userData);
    }
  }, []);

  // Resilient, self-healing org-context load. The previous one-shot version had
  // no retry, collapsed error+empty into null, and re-ran only on user-object
  // identity — so a single transient failure (the org query racing an in-flight
  // token rotation) permanently nulled currentOrganizationId, which silently
  // disables every org-scoped query (useOrgQuery gate) and blanks the dashboard
  // while the user stays logged in. This retries with backoff + a fresh token,
  // and never wipes an already-loaded org on a transient blip.
  const loadOrganization = useCallback(async (): Promise<void> => {
    const currentUser = userRef.current;
    if (!currentUser) {
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      setOrgStatus('idle');
      return;
    }
    if (isSigningOutRef.current) return;

    // Supersede any in-flight load so a newer trigger wins the race.
    if (orgLoadAbortRef.current) orgLoadAbortRef.current.abort();
    const seq = ++orgLoadSeqRef.current;
    const isStale = () => seq !== orgLoadSeqRef.current || isSigningOutRef.current;
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    type OrgJoinRow = { id: string; name: string; logo_url: string | null };
    type OrgMembershipRow = {
      organization_id: string;
      role: string;
      organizations: OrgJoinRow | OrgJoinRow[] | null;
    };

    setOrgStatus('loading');

    const backoffs = [300, 800]; // gaps between 3 attempts
    const maxAttempts = backoffs.length + 1;
    let lastOutcome: 'empty' | 'error' = 'error';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (isStale()) return;

      // Re-read the freshest token before a retry: a member can momentarily get
      // 0 rows (RLS sees a null uid mid-rotation) or a 401 — refreshing first is
      // what rescues that window.
      if (attempt > 0) {
        try {
          await supabase.auth.getSession();
        } catch {
          /* ignore — proceed with whatever token we have */
        }
        if (isStale()) return;
      }

      const ac = new AbortController();
      orgLoadAbortRef.current = ac;
      const timeoutId = setTimeout(() => ac.abort(), 5000);

      const query = supabase
        .from('organization_members')
        .select('organization_id, role, organizations ( id, name, logo_url )')
        .eq('user_id', currentUser.id)
        .limit(1);

      const abortPromise = new Promise<never>((_, reject) => {
        ac.signal.addEventListener('abort', () => reject(new Error('Org query aborted')));
      });

      let result: { data: OrgMembershipRow[] | null; error: unknown };
      try {
        result = (await Promise.race([query, abortPromise])) as {
          data: OrgMembershipRow[] | null;
          error: unknown;
        };
        clearTimeout(timeoutId);
      } catch {
        clearTimeout(timeoutId);
        if (orgLoadAbortRef.current === ac) orgLoadAbortRef.current = null;
        lastOutcome = 'error';
        authDebug('org-load', { attempt, result: 'abort' });
        if (isStale()) return;
        if (attempt < maxAttempts - 1) {
          await delay(backoffs[attempt]);
          continue;
        }
        break;
      }
      if (orgLoadAbortRef.current === ac) orgLoadAbortRef.current = null;
      if (isStale()) return;

      const outcome = classifyOrgLoadResult({ error: result.error, data: result.data });
      authDebug('org-load', { attempt, result: outcome });

      if (outcome === 'rows') {
        const membership = result.data![0];
        const orgData = membership.organizations;
        const org = Array.isArray(orgData) ? orgData[0] : orgData;
        setCurrentOrganizationId(membership.organization_id);
        setCurrentOrgRole(membership.role as OrgRole);
        setCurrentOrganization(
          org
            ? {
                id: org.id,
                name: org.name,
                logo_url: org.logo_url || undefined,
                created_at: new Date().toISOString(),
                created_by: null,
                require_job_photos: (org as { require_job_photos?: boolean }).require_job_photos ?? true,
                cleaner_pay_display:
                  (org as { cleaner_pay_display?: 'full' | 'payout_only' }).cleaner_pay_display ?? 'full',
              }
            : null,
        );
        setOrgStatus('loaded');
        return;
      }

      lastOutcome = outcome; // 'empty' | 'error'
      if (isRetryableOutcome(outcome) && attempt < maxAttempts - 1) {
        await delay(backoffs[attempt]);
        continue;
      }
      break;
    }

    if (isStale()) return;
    const hadOrg = !!currentOrgIdRef.current;
    const terminal = resolveTerminalOrgState(lastOutcome, hadOrg);
    if (terminal.clearOrg) {
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
    }
    setOrgStatus(terminal.status);
    authDebug('org-load:terminal', { lastOutcome, hadOrg, status: terminal.status });
  }, []);

  // Trigger: (re)load on a new user, and self-heal on a token refresh when the
  // org isn't loaded yet. Depending on access_token — not just the user object —
  // is what lets a refreshed token recover a stuck-null org without a full reload.
  useEffect(() => {
    if (!user) {
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      setOrgStatus('idle');
      lastOrgUserIdRef.current = null;
      lastOrgTokenRef.current = undefined;
      return;
    }

    const token = session?.access_token ?? null;
    const userChanged = lastOrgUserIdRef.current !== user.id;
    const tokenChanged = lastOrgTokenRef.current !== token;
    lastOrgUserIdRef.current = user.id;
    lastOrgTokenRef.current = token;

    if (userChanged) {
      void loadOrganization();
      return;
    }
    if (tokenChanged && orgStatusRef.current !== 'loaded') {
      void loadOrganization();
    }
  }, [user, session?.access_token, loadOrganization]);

  // Resolve platform-admin status server-side (see /api/platform/whoami). Kept
  // additive and separate from the fragile auth flow above. Sources the token
  // from `session` (not the later `accessToken` const) to avoid a temporal
  // dead zone in the dependency array.
  useEffect(() => {
    const token = session?.access_token;
    if (!user?.id || !token) {
      setIsPlatformAdmin(null);
      return;
    }
    let cancelled = false;
    // Cache platform-admin status per user for the tab session. /api/platform/whoami
    // is backed by a slow GoTrue token validation in prod, and this effect re-runs on
    // every token rotation — without the cache that re-hits the gate repeatedly. Keyed
    // by user id so a different account never reads a stale value; a fresh browser
    // session (new sessionStorage) re-resolves, which is a fine freshness boundary for
    // the rarely-changing platform-admin set.
    const cacheKey = `${PLATFORM_ADMIN_CACHE_PREFIX}${user.id}`;
    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached === 'true' || cached === 'false') {
        setIsPlatformAdmin(cached === 'true');
        return;
      }
    }
    (async () => {
      try {
        const res = await fetch('/api/platform/whoami', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled || isSigningOutRef.current) return;
        if (res.ok) {
          // Definitive answer (admin → true, or non-admin → false; whoami now
          // returns 200 with the boolean for both). Safe to cache.
          const body = (await res.json().catch(() => null)) as { isPlatformAdmin?: boolean } | null;
          const isAdmin = body?.isPlatformAdmin === true;
          if (cancelled || isSigningOutRef.current) return;
          setIsPlatformAdmin(isAdmin);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(cacheKey, isAdmin ? 'true' : 'false');
          }
        } else {
          // Transient/auth error (401 expired token, 500 lookup failure, ...).
          // Do NOT cache — leave it unresolved for this load so a later token
          // rotation or revisit can recover (a real admin is never locked out
          // of /owner by a cached transient failure).
          setIsPlatformAdmin(false);
        }
      } catch {
        if (!cancelled && !isSigningOutRef.current) setIsPlatformAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, session?.access_token]);

  // Restore/clear "View as" from sessionStorage once platform-admin status is
  // known. Only platform admins can be in this mode; a confirmed non-admin clears it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPlatformAdmin === true) {
      const raw = sessionStorage.getItem(IMPERSONATION_KEY);
      if (raw) {
        try {
          setImpersonation(JSON.parse(raw));
        } catch {
          sessionStorage.removeItem(IMPERSONATION_KEY);
        }
      }
    } else if (isPlatformAdmin === false) {
      setImpersonation(null);
      sessionStorage.removeItem(IMPERSONATION_KEY);
    }
  }, [isPlatformAdmin]);

  const clearImpersonation = () => {
    setImpersonation(null);
    if (typeof window !== 'undefined') sessionStorage.removeItem(IMPERSONATION_KEY);
  };

  const postImpersonationAudit = async (
    action: 'start' | 'end',
    orgId: string,
  ): Promise<boolean> => {
    const token = session?.access_token;
    if (!token) return false;
    try {
      const res = await fetch('/api/platform/impersonation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, organization_id: orgId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const startImpersonation = async (
    orgId: string,
    orgName: string | null = null,
  ): Promise<boolean> => {
    if (isPlatformAdmin !== true) return false;
    // Audit-first: PR #29 promises "every entry/exit is auditable". If the
    // audit POST fails (network error / 5xx) we must NOT enter impersonation,
    // otherwise the admin reads tenant data with no audit record.
    const ok = await postImpersonationAudit('start', orgId);
    if (!ok) return false;
    const next = { orgId, orgName };
    setImpersonation(next);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(next));
    }
    return true;
  };

  const stopImpersonation = () => {
    const orgId = impersonation?.orgId;
    // Always clear locally so a misbehaving audit endpoint can never trap the
    // admin in impersonation; the audit attempt for 'end' is best-effort.
    clearImpersonation();
    if (orgId) void postImpersonationAudit('end', orgId);
  };

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (error) {
          setSession(null);
          setUser(null);
          return;
        }

        const sess = data.session;
        setSession(sess);

        if (sess?.user) {
          await loadUserProfile(sess.user);
        } else {
          setUser(null);
        }
      } catch (err) {
        if (!isMounted) return;
        setSession(null);
        setUser(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    const initPromise = init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sess) => {
      if (!isMounted) return;

      authDebug('auth-event', {
        event,
        hasSess: !!sess,
        tokenTail: tokenTail(sess?.access_token),
        isSigningOut: isSigningOutRef.current,
      });

      if (event === 'SIGNED_OUT' || !sess) {
        const wipe = () => {
          setSession(null);
          setUser(null);
          setCurrentOrganizationId(null);
          setCurrentOrgRole(null);
          setCurrentOrganization(null);
          setOrgStatus('idle');
          clearImpersonation();
          setLoading(false);
          isSigningInRef.current = false;
        };

        // A sign-out we initiated locally clears immediately and unconditionally.
        if (isSigningOutRef.current) {
          wipe();
          return;
        }

        // Otherwise the event may be spurious (a cross-tab / init race, or a
        // single failed refresh) while a valid session still lives in storage.
        // Confirm with one race-guarded getSession before tearing everything
        // down, so a transient blip doesn't bounce the user to /login. A genuine
        // revocation clears storage first, so getSession returns null here → wipe.
        try {
          const confirm = (await Promise.race([
            supabase.auth.getSession(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('confirm timeout')), 5000),
            ),
          ])) as Awaited<ReturnType<typeof supabase.auth.getSession>>;
          if (!isMounted) return;
          if (isSigningOutRef.current) {
            wipe();
            return;
          }
          const confirmedSession = confirm?.data?.session ?? null;
          if (confirmedSession?.user && confirmedSession.user.id === userRef.current?.id) {
            authDebug('auth-event:spurious-signout-ignored', {
              tokenTail: tokenTail(confirmedSession.access_token),
            });
            setSession(confirmedSession);
            return;
          }
        } catch {
          /* fall through to wipe */
        }
        if (!isMounted) return;
        wipe();
        return;
      }

      if (event === 'SIGNED_IN' && sess?.user) {
        isSigningInRef.current = true;
        if (isCleaningUpRef.current) {
          if (cleanupTimeoutRef.current) {
            clearTimeout(cleanupTimeoutRef.current);
            cleanupTimeoutRef.current = null;
          }
          setIsCleaningUp(false);
        }
        const timeSinceSignOut = Date.now() - lastSignOutTimeRef.current;
        const delay = timeSinceSignOut < 3000 ? 500 : 200;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      setSession(sess);

      if (sess?.user) {
        if (isSigningOutRef.current) return;
        if (event === 'TOKEN_REFRESHED') return;

        try {
          await loadUserProfile(sess.user);
        } catch (err) {
          // fallback handled in loadUserProfile
        } finally {
          if (event === 'SIGNED_IN') isSigningInRef.current = false;
        }
      } else {
        setUser(null);
        isSigningInRef.current = false;
      }
    });

    let lastVisibilityCheck = 0;
    let initialLoadComplete = false;

    const handleVisibilityChange = async () => {
      if (!isMounted || !initialLoadComplete) return;
      if (isSigningOutRef.current || isSigningInRef.current) return;
      if (!userRef.current) return;
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (path === '/login' || path.startsWith('/signup')) return;
      }
      const now = Date.now();
      if (now - lastVisibilityCheck < 2000) return;
      lastVisibilityCheck = now;

      if (document.visibilityState === 'visible') {
        try {
          const { data, error } = await supabase.auth.getSession();
          if (!isMounted || isSigningOutRef.current || isSigningInRef.current) return;
          if (!userRef.current) return;
          if (error) return;
          if (data.session && data.session.user.id === userRef.current.id) {
            setSession(data.session);
          }
        } catch {
          // silent
        }
      }
    };

    initPromise.finally(() => {
      if (isMounted) {
        initialLoadComplete = true;
        setTimeout(() => {
          if (isMounted) document.addEventListener('visibilitychange', handleVisibilityChange);
        }, 2000);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadUserProfile]);

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    try {
      if (isCleaningUpRef.current) {
        return { error: 'Please wait a moment before signing in again' };
      }
      isSigningInRef.current = true;

      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        isSigningInRef.current = false;
        return { error: signInError.message };
      }

      if (data.session) {
        setSession(data.session);
        if (isCleaningUpRef.current) {
          if (cleanupTimeoutRef.current) {
            clearTimeout(cleanupTimeoutRef.current);
            cleanupTimeoutRef.current = null;
          }
          setIsCleaningUp(false);
        }
        setTimeout(() => { isSigningInRef.current = false; }, 1000);
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
      const fetchWithTimeout = async (url: string, options: RequestInit, timeout = 30000) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          clearTimeout(timeoutId);
          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      };

      let lastError: Error | null = null;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const timeout = attempt === 0 ? 30000 : 15000;
          const response = await fetchWithTimeout('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

          const signInResult = await supabase.auth.signInWithPassword({ email, password });

          if (signInResult.error) {
            return { error: 'Account created. Please log in.' };
          }

          if (signInResult.data.session) {
            setSession(signInResult.data.session);
          }

          return { role: userData.role };
        } catch (error) {
          lastError = error as Error;
          if (error instanceof Error && error.name === 'AbortError' && attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          throw error;
        }
      }

      throw lastError || new Error('All signup attempts failed');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: 'Request timed out. Please try again.' };
      }
      return { error: error instanceof Error ? error.message : 'An unexpected error occurred' };
    }
  };

  const performSignOut = async (scope: 'local' | 'global'): Promise<void> => {
    try {
      isSigningOutRef.current = true;
      isSigningInRef.current = false;
      lastSignOutTimeRef.current = Date.now();

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (orgLoadAbortRef.current) {
        orgLoadAbortRef.current.abort();
        orgLoadAbortRef.current = null;
      }

      setUser(null);
      setSession(null);
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      setOrgStatus('idle');
      clearImpersonation();
      setLoading(false);

      // Default to local scope so logging out on one device no longer revokes a
      // shared account's sessions on every other device — Supabase's signOut
      // defaults to 'global'. 'global' is opt-in via signOutEverywhere().
      const signOutPromise = supabase.auth.signOut({ scope });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sign out timeout')), 5000)
      );

      try {
        await Promise.race([signOutPromise, timeoutPromise]);
      } catch (err) {
        // state already cleared
      } finally {
        isSigningOutRef.current = false;
        isSigningInRef.current = false;

        if (cleanupTimeoutRef.current) {
          clearTimeout(cleanupTimeoutRef.current);
          cleanupTimeoutRef.current = null;
        }

        setIsCleaningUp(true);
        cleanupTimeoutRef.current = setTimeout(() => {
          setIsCleaningUp(false);
          cleanupTimeoutRef.current = null;
        }, 1500);
      }
    } catch (err) {
      setUser(null);
      setSession(null);
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      setOrgStatus('idle');
      clearImpersonation();
      setLoading(false);
      isSigningOutRef.current = false;
      isSigningInRef.current = false;
    }
  };

  const signOut = (): Promise<void> => performSignOut('local');
  const signOutEverywhere = (): Promise<void> => performSignOut('global');

  const updateProfile = async (updates: Partial<User['profile']>): Promise<{ error?: string }> => {
    if (!user) return { error: 'No user logged in' };

    try {
      const dbUpdates: Record<string, string | null | undefined> = {};
      if (updates.firstName !== undefined) dbUpdates.first_name = updates.firstName;
      if (updates.lastName !== undefined) dbUpdates.last_name = updates.lastName;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.avatarUrl !== undefined) dbUpdates.avatar_url = updates.avatarUrl;

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(dbUpdates)
        .eq('id', user.id);

      if (updateError) {
        return { error: updateError.message };
      }

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

  useEffect(() => {
    return () => {
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
    };
  }, []);

  const value: AuthState & AuthActions = {
    user,
    loading,
    session,
    signIn,
    signUp,
    signOut,
    signOutEverywhere,
    reloadOrganization: loadOrganization,
    updateProfile,
    accessToken,
    isCleaningUp,
    // When impersonating, override the org context so every org-scoped hook
    // reads the impersonated tenant (and the admin view renders). orgStatus is
    // forced 'loaded' so the dashboard gate never blocks the "View as" view on
    // the admin's own membership load.
    currentOrganizationId: impersonation ? impersonation.orgId : currentOrganizationId,
    currentOrgRole: impersonation ? 'admin' : currentOrgRole,
    currentOrganization,
    orgStatus: impersonation ? 'loaded' : orgStatus,
    isPlatformAdmin,
    impersonatingOrgId: impersonation?.orgId ?? null,
    impersonatingOrgName: impersonation?.orgName ?? null,
    startImpersonation,
    stopImpersonation,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
