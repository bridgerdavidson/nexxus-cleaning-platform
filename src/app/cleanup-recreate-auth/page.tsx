'use client';

import { useState } from 'react';

export default function CleanupRecreateAuth() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const cleanupAndRecreate = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/cleanup-and-recreate-users', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to cleanup and recreate auth', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Cleanup & Recreate Authentication System</h1>
      
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-orange-800 mb-2">🧹 Complete Cleanup & Recreation</h2>
        <p className="text-orange-700 mb-4">
          This will completely clean up and recreate the authentication system by:
        </p>
        <ul className="text-orange-700 mb-4 list-disc list-inside space-y-1">
          <li>🗑️ Deleting existing homeowner and cleaner auth users</li>
          <li>🧹 Cleaning up existing database profiles</li>
          <li>⏱️ Waiting for cleanup to complete</li>
          <li>✨ Creating fresh auth users with correct emails</li>
          <li>🔑 Setting secure passwords</li>
          <li>👤 Creating matching database profiles</li>
          <li>🔗 Ensuring perfect ID synchronization</li>
        </ul>
        <div className="bg-orange-100 border border-orange-300 rounded p-3 mb-4">
          <p className="text-orange-800 font-medium">⚠️ Warning:</p>
          <p className="text-orange-700 text-sm">
            This will delete and recreate homeowner and cleaner users. Any existing data for these users will be lost.
            Admin users will be preserved but passwords will be updated.
          </p>
        </div>
        <button
          onClick={cleanupAndRecreate}
          disabled={loading}
          className="bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Cleaning Up & Recreating...' : '🧹 Cleanup & Recreate Auth System'}
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
                <h4 className="font-medium text-green-800 mb-2">✅ Authentication System Recreated Successfully!</h4>
                <p className="text-green-700">{result.message}</p>
              </div>

              {result.results && (
                <div className="bg-white border rounded p-4">
                  <h5 className="font-medium mb-3">📊 Recreation Results:</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-primary-50 p-3 rounded">
                      <strong className="text-primary-800">Homeowner</strong><br />
                      <span className="text-sm">Auth ID: {result.results.homeowner.authUserId}</span><br />
                      <span className="text-sm">Email: {result.results.homeowner.email}</span><br />
                      <span className="text-sm">Profile Created: ✅</span>
                    </div>
                    <div className="bg-green-50 p-3 rounded">
                      <strong className="text-green-800">Cleaner</strong><br />
                      <span className="text-sm">Auth ID: {result.results.cleaner.authUserId}</span><br />
                      <span className="text-sm">Email: {result.results.cleaner.email}</span><br />
                      <span className="text-sm">Profile Created: ✅</span>
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
                  <h5 className="font-medium mb-3">🔑 Fresh Test Login Credentials:</h5>
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
          <li>Completely removes existing homeowner and cleaner auth users</li>
          <li>Cleans up orphaned database profiles</li>
          <li>Creates fresh auth users with proper email addresses</li>
          <li>Sets secure passwords for all user types</li>
          <li>Creates matching database profiles with synchronized IDs</li>
          <li>Updates admin password for consistency</li>
          <li>Provides comprehensive verification and test credentials</li>
          <li>Ensures a completely clean authentication state</li>
        </ul>
      </div>
    </div>
  );
}
