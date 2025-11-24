'use client';

import { useState } from 'react';

export default function FinalUserCreationPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const createUsers = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/remove-trigger-and-create-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: 'Network error',
        details: String(error)
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Final User Creation</h1>
          
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold text-green-900 mb-4">🎯 Final Solution</h2>
            <p className="text-green-800 mb-4">
              This approach creates users without relying on the problematic database trigger:
            </p>
            <ul className="list-disc list-inside text-green-800 space-y-2">
              <li>🧹 Clean up any existing test users</li>
              <li>👤 Create auth users without metadata (avoid trigger)</li>
              <li>📝 Manually create user profiles with service role</li>
              <li>🔧 Create additional profile entries as needed</li>
              <li>✅ Verify all users and profiles were created</li>
            </ul>
            
            <button
              onClick={createUsers}
              disabled={loading}
              className="mt-6 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '🔄 Creating Users...' : '🎯 Create Admin & Cleaner Users'}
            </button>
          </div>

          {result && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Result:</h3>
              
              {result.success ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <div className="flex items-center mb-4">
                    <span className="text-2xl mr-2">✅</span>
                    <span className="text-green-800 font-semibold">{result.message}</span>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="bg-white p-4 rounded border">
                      <h4 className="font-semibold text-green-800 mb-2">👑 Admin User:</h4>
                      <div className="space-y-1 text-green-700 text-sm">
                        <p><strong>Auth ID:</strong> {result.users.admin.authId}</p>
                        <p><strong>Email:</strong> {result.users.admin.email}</p>
                        <p><strong>Profile Role:</strong> {result.users.admin.profile?.role}</p>
                        <p><strong>Credentials:</strong> {result.credentials.admin.email} / {result.credentials.admin.password}</p>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded border">
                      <h4 className="font-semibold text-green-800 mb-2">🧹 Cleaner User:</h4>
                      <div className="space-y-1 text-green-700 text-sm">
                        <p><strong>Auth ID:</strong> {result.users.cleaner.authId}</p>
                        <p><strong>Email:</strong> {result.users.cleaner.email}</p>
                        <p><strong>Profile Role:</strong> {result.users.cleaner.profile?.role}</p>
                        <p><strong>Cleaner Profile:</strong> {result.users.cleaner.cleanerProfile ? '✅ Created' : '❌ Failed'}</p>
                        <p><strong>Credentials:</strong> {result.credentials.cleaner.email} / {result.credentials.cleaner.password}</p>
                      </div>
                    </div>

                    <div className="bg-white p-4 rounded border">
                      <h4 className="font-semibold text-green-800 mb-2">📊 Database Status:</h4>
                      <div className="space-y-1 text-green-700 text-sm">
                        <p><strong>Total Auth Users:</strong> {result.verification.totalAuthUsers}</p>
                        <p><strong>Total Profiles:</strong> {result.verification.totalProfiles}</p>
                      </div>
                    </div>

                    <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                      <h4 className="font-semibold text-primary-800 mb-2">🚀 Next Steps:</h4>
                      <div className="space-y-1 text-primary-700 text-sm">
                        <p>1. Test login with admin credentials: admin@nexxus.com / Admin123!</p>
                        <p>2. Test login with cleaner credentials: cleaner@nexxus.com / Clean123!</p>
                        <p>3. Verify that the admin dashboard now works properly</p>
                        <p>4. Check that all user roles are functioning correctly</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                  <div className="flex items-center mb-4">
                    <span className="text-2xl mr-2">❌</span>
                    <span className="text-red-800 font-semibold">Error: {result.error}</span>
                  </div>
                  
                  <div className="space-y-2 text-red-700">
                    <p><strong>Details:</strong> {result.details}</p>
                    {result.step && <p><strong>Failed Step:</strong> {result.step}</p>}
                  </div>
                </div>
              )}

              <details className="mt-6">
                <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                  📋 View Full Response
                </summary>
                <pre className="mt-4 bg-gray-100 p-4 rounded-lg text-sm overflow-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
