'use client';

import { useState, useEffect } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { User } from '../types';

export interface AuthState {
  user: User | null;
  loading: boolean;
  session: Session | null;
}

export interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, userData: { firstName: string; lastName: string; role: string }) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User['profile']>) => Promise<{ error?: string }>;
  enterBypassMode: (role: 'admin' | 'homeowner' | 'cleaner') => void;
}

export function useAuth(): AuthState & AuthActions {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [bypassMode, setBypassMode] = useState(false);

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
          // No profile found - create one
          console.log('No profile found, creating one...');
          const { data: newProfile, error: createError } = await supabase
            .from('user_profiles')
            .insert({
              id: supabaseUser.id,
              email: supabaseUser.email || '',
              first_name: '',
              last_name: '',
              role: 'homeowner' as const,
            })
            .select()
            .single();

          if (createError) {
            console.error('Error creating user profile:', createError);
            setLoading(false);
            return;
          }

          console.log('Created new profile:', newProfile);
          
          // Convert the new profile to our User type
          const userData: User = {
            id: supabaseUser.id,
            email: supabaseUser.email || '',
            role: (newProfile?.role as 'homeowner' | 'cleaner' | 'admin') || 'homeowner',
            profile: {
              firstName: newProfile?.first_name || '',
              lastName: newProfile?.last_name || '',
              phone: newProfile?.phone || '',
              address: '',
            },
            createdAt: supabaseUser.created_at,
            updatedAt: newProfile?.updated_at || supabaseUser.created_at,
          };

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
          address: profile?.address || '',
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
      
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error: error.message };
      }

      return {};
    } catch (error) {
      return { error: 'An unexpected error occurred' };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (
    email: string,
    password: string,
    userData: { firstName: string; lastName: string; role: string }
  ): Promise<{ error?: string }> => {
    try {
      setLoading(true);
      
      console.log('Signing up user:', { email, userData });
      
      // Call secure API route that uses admin client to set app_metadata
      const response = await fetch('/api/auth/signup', {
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
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.error || 'Signup failed' };
      }

      console.log('Signup successful:', result);

      // User can now sign in
      return {};
    } catch (error) {
      console.error('Signup error:', error);
      return { error: 'An unexpected error occurred' };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  const updateProfile = async (updates: Partial<User['profile']>): Promise<{ error?: string }> => {
    if (!user) return { error: 'No user logged in' };

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          first_name: updates.firstName,
          last_name: updates.lastName,
          phone: updates.phone,
        })
        .eq('id', user.id);

      if (error) {
        return { error: error.message };
      }

      // Update local user state
      setUser(prev => prev ? {
        ...prev,
        profile: { ...prev.profile, ...updates },
        updatedAt: new Date().toISOString(),
      } : null);

      return {};
    } catch (error) {
      return { error: 'An unexpected error occurred' };
    }
  };

  const enterBypassMode = (role: 'admin' | 'homeowner' | 'cleaner') => {
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
    };

    setBypassMode(true);
    setUser(mockUsers[role]);
    setLoading(false);
    console.log(`Entered bypass mode as ${role}:`, mockUsers[role]);
  };

  return {
    user,
    loading,
    session,
    signIn,
    signUp,
    signOut,
    updateProfile,
    enterBypassMode,
  };
}
