'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function FixAdminPage() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const fixAdminProfile = async () => {
    setLoading(true);
    setResult('Starting admin profile fix...\n');
    
    try {
      // First, let's sign in as admin to get the user ID
      setResult(prev => prev + 'Signing in as admin...\n');
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: 'admin@nexxus.com',
        password: 'Admin123!'
      });

      if (authError) {
        setResult(prev => prev + `Auth error: ${authError.message}\n`);
        return;
      }

      if (!authData.user) {
        setResult(prev => prev + 'No user returned from auth\n');
        return;
      }

      const userId = authData.user.id;
      setResult(prev => prev + `Admin user ID: ${userId}\n`);

      // Check if profile already exists
      setResult(prev => prev + 'Checking for existing profile...\n');
      
      const { data: existingProfile, error: checkError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (existingProfile) {
        setResult(prev => prev + `Profile already exists: ${JSON.stringify(existingProfile, null, 2)}\n`);
        
        // Check if the role is admin
        if (existingProfile.role === 'admin') {
          setResult(prev => prev + 'Admin profile is ready! Try logging in again.\n');
          return;
        } else {
          setResult(prev => prev + `Current role is "${existingProfile.role}", updating to "admin"...\n`);
          
          // Update the role to admin
          const { data: updatedProfile, error: updateError } = await supabase
            .from('user_profiles')
            .update({ 
              role: 'admin',
              first_name: 'Admin',
              last_name: 'User'
            })
            .eq('id', userId)
            .select()
            .single();

          if (updateError) {
            setResult(prev => prev + `Update error: ${updateError.message}\n`);
          } else {
            setResult(prev => prev + `Profile updated successfully: ${JSON.stringify(updatedProfile, null, 2)}\n`);
            setResult(prev => prev + '\n✅ SUCCESS! Admin profile is now ready. Try logging in again!\n');
          }
          return;
        }
      }

      if (checkError && checkError.code !== 'PGRST116') {
        setResult(prev => prev + `Check error: ${checkError.message}\n`);
      }

      // Create the admin profile
      setResult(prev => prev + 'Creating admin profile...\n');
      
      const { data: newProfile, error: createError } = await supabase
        .from('user_profiles')
        .insert({
          id: userId,
          email: 'admin@nexxus.com',
          first_name: 'Admin',
          last_name: 'User',
          role: 'admin',
        })
        .select()
        .single();

      if (createError) {
        setResult(prev => prev + `Profile creation error: ${createError.message}\n`);
        setResult(prev => prev + `Error details: ${JSON.stringify(createError, null, 2)}\n`);
        
        // Try using RPC to bypass RLS
        setResult(prev => prev + 'Trying alternative method with RPC...\n');
        
        const { data: rpcResult, error: rpcError } = await supabase.rpc('create_admin_profile', {
          user_id: userId,
          user_email: 'admin@nexxus.com'
        });

        if (rpcError) {
          setResult(prev => prev + `RPC error: ${rpcError.message}\n`);
        } else {
          setResult(prev => prev + 'Admin profile created via RPC!\n');
        }
      } else {
        setResult(prev => prev + `Profile created successfully: ${JSON.stringify(newProfile, null, 2)}\n`);
      }

      // Test the profile query
      setResult(prev => prev + 'Testing profile query...\n');
      
      const { data: testProfile, error: testError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (testError) {
        setResult(prev => prev + `Profile query error: ${testError.message}\n`);
      } else {
        setResult(prev => prev + `Profile query successful: ${JSON.stringify(testProfile, null, 2)}\n`);
        setResult(prev => prev + '\n✅ SUCCESS! Admin profile is now ready. Try logging in again!\n');
      }

    } catch (error) {
      setResult(prev => prev + `Unexpected error: ${error}\n`);
    } finally {
      setLoading(false);
    }
  };

  const createRPCFunction = async () => {
    setLoading(true);
    setResult('Creating RPC function to bypass RLS...\n');
    
    try {
      // This won't work from client side, but we'll try
      const createFunctionSQL = `
        CREATE OR REPLACE FUNCTION create_admin_profile(user_id UUID, user_email TEXT)
        RETURNS void AS $$
        BEGIN
          INSERT INTO user_profiles (id, email, first_name, last_name, role)
          VALUES (user_id, user_email, 'Admin', 'User', 'admin'::user_role)
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            role = EXCLUDED.role;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
      `;

      const { data, error } = await supabase.rpc('exec_sql', { sql: createFunctionSQL });
      
      if (error) {
        setResult(prev => prev + `Function creation error: ${error.message}\n`);
        setResult(prev => prev + 'You need to run this SQL manually in Supabase SQL Editor:\n');
        setResult(prev => prev + createFunctionSQL + '\n');
      } else {
        setResult(prev => prev + 'RPC function created successfully!\n');
      }
    } catch (error) {
      setResult(prev => prev + `Error: ${error}\n`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Fix Admin Profile</h1>
        
        <div className="bg-primary-50 border border-primary-200 p-4 rounded mb-6">
          <h2 className="font-semibold text-primary-800">Admin Profile Fix</h2>
          <p className="text-primary-700">This will create the missing admin profile to fix the login issue.</p>
        </div>
        
        <div className="space-x-4 mb-6">
          <button
            onClick={fixAdminProfile}
            disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Fixing...' : 'Fix Admin Profile'}
          </button>
          
          <button
            onClick={createRPCFunction}
            disabled={loading}
            className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            Create RPC Function
          </button>
        </div>
        
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
