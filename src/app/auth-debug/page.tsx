'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

export default function AuthDebug() {
  const { user, loading, session } = useAuth();
  const [authUsers, setAuthUsers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const loadData = async () => {
    setLoadingData(true);
    try {
      // Get current session info
      const { data: sessionData } = await supabase.auth.getSession();
      console.log('Current session:', sessionData);

      // Get all profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from('user_profiles')
        .select('*')
        .order('email');

      if (profilesError) {
        console.error('Error loading profiles:', profilesError);
      } else {
        setProfiles(profilesData || []);
      }

      // Try to get auth users via API
      const response = await fetch('/api/list-auth-users');
      const authData = await response.json();
      if (authData.users) {
        setAuthUsers(authData.users);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const fixAdminUser = async () => {
    try {
      const response = await fetch('/api/fix-admin-user', {
        method: 'POST',
      });
      const result = await response.json();
      console.log('Fix admin result:', result);
      alert(result.success ? 'Admin user fixed!' : `Error: ${result.error}`);
      loadData(); // Reload data
    } catch (error) {
      console.error('Error fixing admin user:', error);
      alert('Error fixing admin user');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Authentication Debug</h1>
      
      <div className="space-y-6">
        {/* Current Auth State */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Current Auth State</h2>
          <div className="space-y-2">
            <p><strong>Loading:</strong> {loading ? 'Yes' : 'No'}</p>
            <p><strong>Session:</strong> {session ? 'Active' : 'None'}</p>
            <p><strong>User ID:</strong> {user?.id || 'None'}</p>
            <p><strong>Email:</strong> {user?.email || 'None'}</p>
            <p><strong>Role:</strong> {user?.role || 'None'}</p>
            <p><strong>First Name:</strong> {user?.profile?.firstName || 'None'}</p>
            <p><strong>Last Name:</strong> {user?.profile?.lastName || 'None'}</p>
          </div>
          
          {session && (
            <div className="mt-4 p-4 bg-gray-50 rounded">
              <h3 className="font-medium mb-2">Session Details:</h3>
              <pre className="text-sm overflow-auto">
                {JSON.stringify(session, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Auth Users */}
        <div className="bg-white border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Auth Users</h2>
            <button 
              onClick={loadData}
              disabled={loadingData}
              className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
            >
              {loadingData ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          
          {authUsers.length > 0 ? (
            <div className="space-y-2">
              {authUsers.map((authUser, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded">
                  <p><strong>ID:</strong> {authUser.id}</p>
                  <p><strong>Email:</strong> {authUser.email}</p>
                  <p><strong>Created:</strong> {new Date(authUser.created_at).toLocaleString()}</p>
                  <p><strong>Email Confirmed:</strong> {authUser.email_confirmed_at ? 'Yes' : 'No'}</p>
                  {authUser.user_metadata && (
                    <p><strong>Metadata:</strong> {JSON.stringify(authUser.user_metadata)}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600">No auth users found or unable to load</p>
          )}
        </div>

        {/* Database Profiles */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Database Profiles</h2>
          
          {profiles.length > 0 ? (
            <div className="space-y-2">
              {profiles.map((profile) => (
                <div key={profile.id} className="p-3 bg-gray-50 rounded">
                  <p><strong>ID:</strong> {profile.id}</p>
                  <p><strong>Email:</strong> {profile.email}</p>
                  <p><strong>Role:</strong> {profile.role}</p>
                  <p><strong>Name:</strong> {profile.first_name} {profile.last_name}</p>
                  <p><strong>Created:</strong> {new Date(profile.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600">No profiles found</p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <button 
              onClick={fixAdminUser}
              className="bg-red-600 text-white px-6 py-3 rounded hover:bg-red-700"
            >
              🔧 Fix Admin User
            </button>
            
            <div className="flex flex-wrap gap-3">
              <a 
                href="/login" 
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 inline-block"
              >
                Login Page
              </a>
              <a 
                href="/admin-dashboard" 
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 inline-block"
              >
                Admin Dashboard
              </a>
              <a 
                href="/list-users" 
                className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 inline-block"
              >
                List Users
              </a>
            </div>
          </div>
        </div>

        {/* Navigation Help */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800 mb-2">🔍 Debugging Steps:</h3>
          <ol className="text-yellow-700 list-decimal list-inside space-y-1">
            <li>Check if you're logged in and what role you have</li>
            <li>Verify the admin user exists in both auth and profiles</li>
            <li>Use "Fix Admin User" if there are issues</li>
            <li>Try logging in as admin@nexxus.com with password Admin123!</li>
            <li>Navigate to admin dashboard to test</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
