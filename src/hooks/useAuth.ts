'use client';

import { useState, useEffect } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { User } from '../types';

export interface AuthState {
  user: User | null;
  loading: boolean;
  session: Session | null;
  accessToken: string | null | undefined;
}

export interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, userData: { firstName: string; lastName: string; role: string }) => Promise<{ error?: string; role?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User['profile']>) => Promise<{ error?: string }>;
}

export function useAuth(): AuthState & AuthActions {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let isMounted = true;
  
    const init = async () => {
      // initial auth check
      const { data, error } = await supabase.auth.getSession();
  
      if (!isMounted) return;
      if (error) {
        console.error('Error getting session:', error);
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }
  
      const session = data.session;
      setSession(session);
  
      if (session?.user) {
        // wait for profile to load before finishing initial "loading"
        await loadUserProfile(session.user);
      }
  
      setLoading(false); // ✅ initial auth flow done (logged in or not)
    };
  
    init();
  
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return;
  
      setSession(session);
  
      if (session?.user) {
        // user logged in / refreshed → just update user
        await loadUserProfile(session.user);
      } else {
        // signed out
        setUser(null);
      }
      // ❌ no setLoading(true/false) here – loading is only for initial check
    });
  
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);
  
  const getRoleFromAuth = (supabaseUser: SupabaseUser): User['role'] => {
    return (
      (supabaseUser.app_metadata?.role as User['role']) ||
      (supabaseUser.user_metadata?.role as User['role']) ||
      'homeowner'
    );
  };
  
  const buildUserFromAuthOnly = (supabaseUser: SupabaseUser): User => {
    const role = getRoleFromAuth(supabaseUser);
  
    return {
      id: supabaseUser.id,
      email: supabaseUser.email || '',
      role,
      profile: {
        firstName: (supabaseUser.user_metadata?.firstName as string) || '',
        lastName: (supabaseUser.user_metadata?.lastName as string) || '',
        phone: (supabaseUser.user_metadata?.phone as string) || '',
        avatarUrl: undefined,
      },
      createdAt: supabaseUser.created_at,
      updatedAt: supabaseUser.created_at,
    };
  };
  
  const loadUserProfile = async (supabaseUser: SupabaseUser) => {
    const callId = Math.random().toString(36).substring(7);
  
    try {
      console.log(`[${callId}] Loading profile for user:`, supabaseUser.id, supabaseUser.email);
  
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', supabaseUser.id)
        .single();
  
      if (error) {
        // we'll fix the role logic below 👇
        if (error.code === 'PGRST116') {
          console.log(`[${callId}] No profile row found (PGRST116). Using auth metadata only.`);
          const userData = buildUserFromAuthOnly(supabaseUser);
          setUser(userData);
          return;
        }
  
        console.error(`[${callId}] Error loading user profile:`, error);
        setUser(null);
        return;
      }
  
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
  
      console.log(`[${callId}] Successfully loaded user profile:`, userData);
      setUser(userData);
    } catch (err) {
      console.error(`[${callId}] Unexpected error loading user profile:`, err);
      setUser(null);
    }
  };
  
  

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    setLoading(true);
  
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
  
      if (signInError) {
        setLoading(false);
        return { error: signInError.message };
      }
  
      if (data.session) {
        setSession(data.session);
        // onAuthStateChange + loadUserProfile will run next
      }
  
      return {};
    } catch (error) {
      console.error('Sign in error:', error);
      setLoading(false);
      return { error: 'An unexpected error occurred' };
    }
  };
  

  const signUp = async (
    email: string,
    password: string,
    userData: { firstName: string; lastName: string; role: string }
  ): Promise<{ error?: string; role?: string }> => {
    try {
      console.log('Signing up user:', { email, userData });
      
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
          console.log(`Signup attempt ${attempt + 1}/${maxRetries + 1}`);
          
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

          console.log('Signup successful:', result);

          // Automatically sign in the user after successful signup
          console.log('Auto-signing in user...');
          const signInResult = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (signInResult.error) {
            console.error('Auto sign-in failed:', signInResult.error);
            setLoading(false);
            // Signup succeeded but auto sign-in failed - user can manually log in
            return { error: 'Account created. Please log in.' };
          }

          if (signInResult.data.session) {
            setSession(signInResult.data.session);
            console.log('Auto sign-in successful');
            // Loading state will be managed by onAuthStateChange -> loadUserProfile
          }

          // Return the role so the signup page can redirect appropriately
          return { role: userData.role };
        } catch (error) {
          lastError = error as Error;
          console.error(`Signup attempt ${attempt + 1} failed:`, error);
          
          // If it's an abort error (timeout) and we have retries left, try again
          if (error instanceof Error && error.name === 'AbortError' && attempt < maxRetries) {
            console.log('Request timed out, retrying...');
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
      console.error('Signup error:', error);
      setLoading(false);
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: 'Request timed out. Please try again.' };
      }
      return { error: error instanceof Error ? error.message : 'An unexpected error occurred' };
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      // Let Supabase fully clear the session (localStorage, listeners, etc.)
      await supabase.auth.signOut();
    } catch (error) {
      console.warn('Supabase signOut error:', error);
      // Even if the network fails, supabase-js usually clears local state,
      // but we still defensively clear our own state below.
    }
  
    // Clear local auth state used by your app
    setUser(null);
    setSession(null);
  
    // Redirect to home (soft navigation is fine)
    if (typeof window !== 'undefined') {
      window.location.href = '/'; // or use Next router if you want
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

  return {
    user,
    loading,
    session,
    signIn,
    signUp,
    signOut,
    updateProfile,
    accessToken,
  };
}
