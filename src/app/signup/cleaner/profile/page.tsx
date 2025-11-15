'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../hooks/useAuth';
import { Loader, Sparkles, ArrowRight } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';

export default function CleanerProfileCompletion() {
  const [bio, setBio] = useState('');
  const [experienceYears, setExperienceYears] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = async () => {
      // Wait for auth to load
      if (!loading) {
        if (!user) {
          // User not authenticated, redirect to login
          router.push('/login');
        } else if (user.role !== 'cleaner') {
          // Not a cleaner, redirect to appropriate dashboard
          router.push(`/${user.role}-dashboard`);
        } else {
          setIsAuthenticating(false);
        }
      }
    };
    
    checkAuth();
  }, [user, loading, router]);

  const handleComplete = async () => {
    setError('');
    setIsLoading(true);

    try {
      if (!user) {
        setError('You must be logged in to complete your profile');
        setIsLoading(false);
        return;
      }

      // Insert into cleaner_profiles table
      const { error: insertError } = await supabase
        .from('cleaner_profiles')
        .insert({
          id: user.id,
          bio: bio || null,
          experience_years: experienceYears || null,
          is_available: true,
        });

      if (insertError) {
        console.error('Error creating cleaner profile:', insertError);
        setError('Failed to create profile. It may already exist.');
      } else {
        // Redirect to login
        router.push('/login');
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = async () => {
    setError('');
    setIsLoading(true);

    try {
      if (!user) {
        setError('You must be logged in to skip');
        setIsLoading(false);
        return;
      }

      // Create empty cleaner profile
      const { error: insertError } = await supabase
        .from('cleaner_profiles')
        .insert({
          id: user.id,
          is_available: true,
        });

      if (insertError) {
        console.error('Error creating cleaner profile:', insertError);
        // Might already exist, just redirect
      }
      
      // Redirect to login
      router.push('/login');
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (loading || isAuthenticating) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-2xl">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-success-100 rounded-full mb-6">
            <Sparkles className="w-10 h-10 text-success-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Welcome to Nexxus!
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Let's complete your cleaner profile
          </p>
          <p className="text-sm text-gray-500">
            This is optional - you can skip and add this information later
          </p>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-2xl">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-gray-700 mb-2">
                Tell us about yourself
              </label>
              <textarea
                id="bio"
                rows={6}
                maxLength={500}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="input-field"
                placeholder="Share your experience, specialties, and what makes you a great cleaner..."
              />
              <p className="mt-1 text-sm text-gray-500">
                {bio.length}/500 characters
              </p>
            </div>

            <div>
              <label htmlFor="experienceYears" className="block text-sm font-medium text-gray-700 mb-2">
                Years of experience
              </label>
              <input
                id="experienceYears"
                type="number"
                min="0"
                max="50"
                value={experienceYears}
                onChange={(e) => setExperienceYears(e.target.value ? parseInt(e.target.value) : '')}
                className="input-field"
                placeholder="How many years have you been cleaning professionally?"
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> Your hourly rate will be set by an administrator. 
                This helps ensure fair and consistent pricing across our platform.
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleSkip}
              disabled={isLoading}
              className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Processing...' : 'Skip for Now'}
            </button>
            <button
              onClick={handleComplete}
              disabled={isLoading}
              className="flex-1 btn-primary flex justify-center items-center space-x-2"
            >
              {isLoading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>Complete Profile</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          <p className="mt-4 text-center text-sm text-gray-500">
            You'll be able to edit this information in your dashboard later
          </p>
        </div>
      </div>
    </div>
  );
}

