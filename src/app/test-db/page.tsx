'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function TestDBPage() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const testConnection = async () => {
    setLoading(true);
    setResult('Testing connection...\n');
    
    try {
      // Test basic connection
      const { data: authData, error: authError } = await supabase.auth.getSession();
      setResult(prev => prev + `Auth connection: ${authError ? 'ERROR - ' + authError.message : 'OK'}\n`);
      
      // Test if user_profiles table exists
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('count')
        .limit(1);
      
      setResult(prev => prev + `user_profiles table: ${profileError ? 'ERROR - ' + profileError.message : 'OK'}\n`);
      
      if (profileError) {
        setResult(prev => prev + `Profile error details: ${JSON.stringify(profileError, null, 2)}\n`);
      }
      
      // Test if we can create a profile
      if (!profileError) {
        const testUserId = '398b46f2-d083-4be1-863f-fd523017ddf0';
        
        // Check if profile exists
        const { data: existingProfile, error: checkError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', testUserId)
          .single();
          
        setResult(prev => prev + `Existing profile check: ${checkError ? 'No profile found' : 'Profile exists'}\n`);
        
        if (checkError && checkError.code === 'PGRST116') {
          // Create the profile
          const { data: newProfile, error: createError } = await supabase
            .from('user_profiles')
            .insert({
              id: testUserId,
              email: 'admin@nexxus.com',
              first_name: 'Admin',
              last_name: 'User',
              role: 'admin' as const,
            })
            .select()
            .single();
            
          setResult(prev => prev + `Profile creation: ${createError ? 'ERROR - ' + createError.message : 'SUCCESS'}\n`);
          
          if (newProfile) {
            setResult(prev => prev + `Created profile: ${JSON.stringify(newProfile, null, 2)}\n`);
          }
        } else if (existingProfile) {
          setResult(prev => prev + `Existing profile: ${JSON.stringify(existingProfile, null, 2)}\n`);
        }
      }
      
    } catch (error) {
      setResult(prev => prev + `Unexpected error: ${error}\n`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Database Connection Test</h1>
        
        <button
          onClick={testConnection}
          disabled={loading}
          className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Database Connection'}
        </button>
        
        {result && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold mb-2">Results:</h2>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto whitespace-pre-wrap">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
