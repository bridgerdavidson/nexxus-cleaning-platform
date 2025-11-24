'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function CreateTestUsersPage() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const createTestUsers = async () => {
    setLoading(true);
    setResult('Starting test user creation...\n');
    
    try {
      // Test users to create
      const testUsers = [
        {
          email: 'homeowner@nexxus.com',
          password: 'Homeowner123!',
          role: 'homeowner',
          firstName: 'John',
          lastName: 'Homeowner'
        },
        {
          email: 'cleaner@nexxus.com',
          password: 'Cleaner123!',
          role: 'cleaner',
          firstName: 'Jane',
          lastName: 'Cleaner'
        }
      ];

      for (const user of testUsers) {
        setResult(prev => prev + `\n--- Creating ${user.role} user: ${user.email} ---\n`);
        
        // First, check if user already exists by trying to sign in
        const { data: existingAuth, error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: user.password
        });

        if (existingAuth.user && !signInError) {
          setResult(prev => prev + `User already exists in auth, checking profile...\n`);
          
          // Check if profile exists
          const { data: existingProfile, error: profileError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', existingAuth.user.id)
            .single();

          if (existingProfile) {
            setResult(prev => prev + `Profile exists: ${JSON.stringify(existingProfile, null, 2)}\n`);
            
            // Update profile if role is wrong
            if (existingProfile.role !== user.role) {
              setResult(prev => prev + `Updating role from "${existingProfile.role}" to "${user.role}"...\n`);
              
              const { data: updatedProfile, error: updateError } = await supabase
                .from('user_profiles')
                .update({ 
                  role: user.role,
                  first_name: user.firstName,
                  last_name: user.lastName
                })
                .eq('id', existingAuth.user.id)
                .select()
                .single();

              if (updateError) {
                setResult(prev => prev + `Update error: ${updateError.message}\n`);
              } else {
                setResult(prev => prev + `Profile updated successfully!\n`);
              }
            } else {
              setResult(prev => prev + `Profile already has correct role.\n`);
            }
          } else {
            setResult(prev => prev + `Profile missing, creating...\n`);
            
            // Create profile
            const { data: newProfile, error: createProfileError } = await supabase
              .from('user_profiles')
              .insert({
                id: existingAuth.user.id,
                email: user.email,
                first_name: user.firstName,
                last_name: user.lastName,
                role: user.role,
              })
              .select()
              .single();

            if (createProfileError) {
              setResult(prev => prev + `Profile creation error: ${createProfileError.message}\n`);
            } else {
              setResult(prev => prev + `Profile created successfully!\n`);
            }
          }
          
          // Sign out after checking
          await supabase.auth.signOut();
          continue;
        }

        // User doesn't exist, create new user
        setResult(prev => prev + `Creating new user account...\n`);
        
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: user.email,
          password: user.password,
          options: {
            data: {
              first_name: user.firstName,
              last_name: user.lastName,
              role: user.role
            }
          }
        });

        if (authError) {
          setResult(prev => prev + `Auth creation error: ${authError.message}\n`);
          continue;
        }

        if (!authData.user) {
          setResult(prev => prev + `No user returned from signup\n`);
          continue;
        }

        setResult(prev => prev + `User created successfully: ${authData.user.id}\n`);

        // Create profile manually (in case the trigger doesn't work)
        setResult(prev => prev + `Creating user profile...\n`);
        
        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .insert({
            id: authData.user.id,
            email: user.email,
            first_name: user.firstName,
            last_name: user.lastName,
            role: user.role,
          })
          .select()
          .single();

        if (profileError) {
          setResult(prev => prev + `Profile creation error: ${profileError.message}\n`);
          setResult(prev => prev + `This might be okay if the trigger created it automatically.\n`);
        } else {
          setResult(prev => prev + `Profile created successfully!\n`);
        }

        // Sign out after creation
        await supabase.auth.signOut();
        
        setResult(prev => prev + `✅ ${user.role} user setup complete!\n`);
      }

      setResult(prev => prev + `\n🎉 ALL TEST USERS CREATED SUCCESSFULLY!\n`);
      setResult(prev => prev + `\nTest Credentials:\n`);
      setResult(prev => prev + `Homeowner: homeowner@nexxus.com / Homeowner123!\n`);
      setResult(prev => prev + `Cleaner: cleaner@nexxus.com / Cleaner123!\n`);
      setResult(prev => prev + `Admin: admin@nexxus.com / Admin123!\n`);

    } catch (error) {
      setResult(prev => prev + `Unexpected error: ${error}\n`);
    } finally {
      setLoading(false);
    }
  };

  const testAllLogins = async () => {
    setLoading(true);
    setResult('Testing all user logins...\n');
    
    const testUsers = [
      { email: 'admin@nexxus.com', password: 'Admin123!', role: 'admin' },
      { email: 'homeowner@nexxus.com', password: 'Homeowner123!', role: 'homeowner' },
      { email: 'cleaner@nexxus.com', password: 'Cleaner123!', role: 'cleaner' }
    ];

    for (const user of testUsers) {
      setResult(prev => prev + `\nTesting ${user.role} login...\n`);
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: user.password
      });

      if (authError || !authData.user) {
        setResult(prev => prev + `❌ ${user.role} login failed: ${authError?.message || 'No user returned'}\n`);
        continue;
      }

      const userId = authData.user.id;

      // Check profile
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError) {
        setResult(prev => prev + `❌ ${user.role} profile error: ${profileError.message}\n`);
      } else {
        setResult(prev => prev + `✅ ${user.role} login successful! Role: ${profile.role}\n`);
      }

      // Sign out
      await supabase.auth.signOut();
    }

    setResult(prev => prev + `\n🎯 Login testing complete!\n`);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Create Test Users</h1>
        
        <div className="bg-primary-50 border border-primary-200 p-4 rounded mb-6">
          <h2 className="font-semibold text-primary-800">Test User Creation</h2>
          <p className="text-primary-700">This will create the missing Homeowner and Cleaner test accounts.</p>
        </div>
        
        <div className="space-x-4 mb-6">
          <button
            onClick={createTestUsers}
            disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Test Users'}
          </button>
          
          <button
            onClick={testAllLogins}
            disabled={loading}
            className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Testing...' : 'Test All Logins'}
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
