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
  enterBypassMode: (role: 'admin' | 'homeowner' | 'cleaner' | 'manager') => void;
}

export function useAuth(): AuthState & AuthActions {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadUserProfile(session.user);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      if (session?.user) {
        await loadUserProfile(session.user);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (supabaseUser: SupabaseUser) => {
    try {
      console.log('Loading profile for user:', supabaseUser.id, supabaseUser.email);
      
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', supabaseUser.id)
        .single();

      console.log('Profile query result:', { profile, error });

      if (error) {
        if (error.code === 'PGRST116') {
          // No profile found - the database trigger should have created it
          // Wait a moment and try again (might be a timing issue)
          console.log('No profile found, waiting and retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const { data: retryProfile, error: retryError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', supabaseUser.id)
            .single();

          if (retryError || !retryProfile) {
            // Only log as error if it's not a "not found" error (PGRST116)
            if (retryError?.code === 'PGRST116') {
              console.log('Profile not found - user may need to complete signup');
            } else {
              console.error('Profile still not found after retry:', retryError);
            }
            setLoading(false);
            return;
          }

          // Profile found on retry - convert to User type
          const userData: User = {
            id: supabaseUser.id,
            email: supabaseUser.email || '',
            role: (retryProfile?.role as 'homeowner' | 'cleaner' | 'admin' | 'manager') || 'homeowner',
            profile: {
              firstName: retryProfile?.first_name || '',
              lastName: retryProfile?.last_name || '',
              phone: retryProfile?.phone || '',
              avatarUrl: retryProfile?.avatar_url || undefined,
            },
            createdAt: supabaseUser.created_at,
            updatedAt: retryProfile?.updated_at || supabaseUser.created_at,
          };

          console.log('Successfully loaded user profile after retry:', userData);
          setUser(userData);
          return;
        } else {
          console.error('Error loading user profile:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code
          });
          setLoading(false);
          return;
        }
      }

      // Convert Supabase user to our User type
      const userData: User = {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        role: (profile?.role as 'homeowner' | 'cleaner' | 'admin') || 'homeowner',
        profile: {
          firstName: profile?.first_name || '',
          lastName: profile?.last_name || '',
          phone: profile?.phone || '',
          avatarUrl: profile?.avatar_url || undefined,
        },
        createdAt: supabaseUser.created_at,
        updatedAt: profile?.updated_at || supabaseUser.created_at,
      };

      console.log('Successfully loaded user profile:', userData);
      setUser(userData);
    } catch (error) {
      console.error('Unexpected error loading user profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    try {
      setLoading(true);
      
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        return { error: signInError.message };
      }
      if (data.session) {
        setSession(data.session);
        // also update user if you don't already
      }
      return {};
    } catch {
      return { error: 'An unexpected error occurred' };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (
    email: string,
    password: string,
    userData: { firstName: string; lastName: string; role: string }
  ): Promise<{ error?: string; role?: string }> => {
    try {
      setLoading(true);
      
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
            // Signup succeeded but auto sign-in failed - user can manually log in
            return { error: 'Account created. Please log in.' };
          }

          if (signInResult.data.session) {
            setSession(signInResult.data.session);
            console.log('Auto sign-in successful');
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
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: 'Request timed out. Please try again.' };
      }
      return { error: error instanceof Error ? error.message : 'An unexpected error occurred' };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      // Call signOut on Supabase first (with timeout for reliability)
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Signout timeout')), 5000)
        )
      ]);
    } catch (error) {
      // If timeout or error, log but continue with cleanup
      console.warn('Supabase signOut timeout/error:', error);
    }
    
    // Clear local state after Supabase signOut completes
    setUser(null);
    setSession(null);
    
    // Now redirect - session is actually cleared
    if (typeof window !== 'undefined') {
      window.location.href = '/';
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

  const enterBypassMode = (role: 'admin' | 'homeowner' | 'cleaner' | 'manager') => {
    const mockUsers = {
      admin: {
        id: 'mock-admin-id',
        email: 'admin@nexxus.com',
        role: 'admin' as const,
        profile: {
          firstName: 'Admin',
          lastName: 'User',
          phone: '(555) 123-4567',
          address: '123 Business St, Admin City, AC 12345',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      homeowner: {
        id: 'mock-homeowner-id',
        email: 'homeowner@nexxus.com',
        role: 'homeowner' as const,
        profile: {
          firstName: 'Home',
          lastName: 'Owner',
          phone: '(555) 234-5678',
          address: '456 Residential Ave, Home City, HC 23456',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      cleaner: {
        id: 'mock-cleaner-id',
        email: 'cleaner@nexxus.com',
        role: 'cleaner' as const,
        profile: {
          firstName: 'Professional',
          lastName: 'Cleaner',
          phone: '(555) 345-6789',
          address: '789 Service Rd, Clean City, CC 34567',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      manager: {
        id: 'mock-manager-id',
        email: 'manager@nexxus.com',
        role: 'manager' as const,
        profile: {
          firstName: 'Operations',
          lastName: 'Manager',
          phone: '(555) 456-7890',
          address: '321 Management Blvd, Manager City, MC 45678',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    setUser(mockUsers[role]);
    setLoading(false);
    console.log(`Entered bypass mode as ${role}:`, mockUsers[role]);
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
    enterBypassMode,
    accessToken,
  };
}
