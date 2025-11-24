'use client';

import { useState } from 'react';

export default function CreateCompleteAuth() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const createCompleteAuth = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/create-missing-auth-users-final', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to create complete auth', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Create Complete Authentication System</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">🚀 Final Authentication Setup</h2>
        <p className="text-primary-700 mb-4">
          This will create the complete authentication system by:
        </p>
        <ul className="text-primary-700 mb-4 list-disc list-inside space-y-1">
          <li>✅ Creating missing auth users (homeowner@nexxus.com, cleaner@nexxus.com)</li>
          <li>🔑 Setting passwords for all users</li>
          <li>👤 Creating/updating database profiles</li>
          <li>🔗 Synchronizing auth IDs with profile IDs</li>
          <li>✨ Providing test credentials</li>
        </ul>
        <p className="text-primary-700 mb-4">
          <strong>This is the complete solution that will fix all authentication issues!</strong>
        </p>
        <button
          onClick={createCompleteAuth}
          disabled={loading}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Creating Complete Auth System...' : '🚀 Create Complete Auth System'}
        </button>
      </div>

      {result && (
        <div className={`border rounded-lg p-4 mb-6 ${
          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h3 className="font-semibold mb-2">Result:</h3>
          
          {result.success ? (
            <div className="space-y-4">
              <div className="mb-4">
                <h4 className="font-medium text-green-800 mb-2">✅ Authentication System Created Successfully!</h4>
                <p className="text-green-700">{result.message}</p>
              </div>

              {result.results && (
                <div className="bg-white border rounded p-4">
                  <h5 className="font-medium mb-3">📊 Creation Results:</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-primary-50 p-3 rounded">
                      <strong className="text-primary-800">Homeowner</strong><br />
                      <span className="text-sm">Auth ID: {result.results.homeowner.authUserId}</span><br />
                      <span className="text-sm">Email: {result.results.homeowner.email}</span><br />
                      <span className="text-sm">Created: {result.results.homeowner.authUserCreated ? 'Yes' : 'Updated existing'}</span>
                    </div>
                    <div className="bg-green-50 p-3 rounded">
                      <strong className="text-green-800">Cleaner</strong><br />
                      <span className="text-sm">Auth ID: {result.results.cleaner.authUserId}</span><br />
                      <span className="text-sm">Email: {result.results.cleaner.email}</span><br />
                      <span className="text-sm">Created: {result.results.cleaner.authUserCreated ? 'Yes' : 'Updated existing'}</span>
                    </div>
                  </div>
                </div>
              )}

              {result.verification && (
                <div className="bg-white border rounded p-4">
                  <h5 className="font-medium mb-3">🔍 System Verification:</h5>
                  <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <strong>Total Auth Users:</strong> {result.verification.totalAuthUsers}
                    </div>
                    <div>
                      <strong>Total Profiles:</strong> {result.verification.totalProfiles}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div>
                      <strong className="text-primary-800">Auth Users:</strong>
                      <div className="text-sm text-gray-600">
                        {result.verification.authUsers.map((user: any, index: number) => (
                          <div key={index}>• {user.email} (ID: {user.id.substring(0, 8)}...)</div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <strong className="text-purple-800">Database Profiles:</strong>
                      <div className="text-sm text-gray-600">
                        {result.verification.profiles.map((profile: any, index: number) => (
                          <div key={index}>• {profile.email} ({profile.role}) - ID: {profile.id.substring(0, 8)}...</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {result.testCredentials && (
                <div className="bg-white border rounded p-4">
                  <h5 className="font-medium mb-3">🔑 Test Login Credentials:</h5>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-primary-50 p-3 rounded">
                      <strong className="text-primary-800">Homeowner</strong><br />
                      <span className="text-sm">Email: {result.testCredentials.homeowner.email}</span><br />
                      <span className="text-sm">Password: {result.testCredentials.homeowner.password}</span>
                    </div>
                    <div className="bg-green-50 p-3 rounded">
                      <strong className="text-green-800">Cleaner</strong><br />
                      <span className="text-sm">Email: {result.testCredentials.cleaner.email}</span><br />
                      <span className="text-sm">Password: {result.testCredentials.cleaner.password}</span>
                    </div>
                    <div className="bg-purple-50 p-3 rounded">
                      <strong className="text-purple-800">Admin</strong><br />
                      <span className="text-sm">Email: {result.testCredentials.admin.email}</span><br />
                      <span className="text-sm">Password: {result.testCredentials.admin.password}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <a 
                  href="/login" 
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 inline-block"
                >
                  🚀 Test Login Now →
                </a>
                <a 
                  href="/homeowner-dashboard" 
                  className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 inline-block"
                >
                  Homeowner Dashboard
                </a>
                <a 
                  href="/cleaner-dashboard" 
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 inline-block"
                >
                  Cleaner Dashboard
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
                  Verify Users
                </a>
              </div>
            </div>
          ) : (
            <div className="text-red-700">
              <p><strong>Error:</strong> {result.error}</p>
              {result.details && <p><strong>Details:</strong> {result.details}</p>}
              {result.step && <p><strong>Failed at step:</strong> {result.step}</p>}
            </div>
          )}
          
          <details className="mt-4">
            <summary className="cursor-pointer font-medium">View Full Response</summary>
            <pre className="text-sm overflow-auto whitespace-pre-wrap mt-2 bg-gray-100 p-2 rounded">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">What This Does</h3>
        <ul className="text-gray-700 list-disc list-inside space-y-1">
          <li>Creates missing auth users in Supabase Auth system</li>
          <li>Sets secure passwords for all user types</li>
          <li>Creates or updates database profiles with correct IDs</li>
          <li>Ensures auth user IDs match profile IDs perfectly</li>
          <li>Provides comprehensive verification and test credentials</li>
          <li>Fixes all authentication and dashboard access issues</li>
        </ul>
      </div>
    </div>
  );
}
