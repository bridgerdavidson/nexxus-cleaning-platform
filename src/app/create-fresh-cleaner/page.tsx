'use client';

import { useState } from 'react';

export default function CreateFreshCleaner() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const createFreshCleaner = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/create-fresh-cleaner', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ 
        success: false, 
        error: 'Failed to create fresh cleaner', 
        details: String(error) 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Create Fresh Cleaner User</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">🧹 Fresh Cleaner Creation</h2>
        <p className="text-primary-700 mb-4">
          This will create a completely fresh cleaner user with no conflicts:
        </p>
        <ul className="text-primary-700 mb-4 list-disc list-inside space-y-1">
          <li>🗑️ Clean up any old cleaner data</li>
          <li>✨ Create fresh auth user: cleanertest@nexxus.com</li>
          <li>👤 Create matching database profile</li>
          <li>🔧 Create cleaner_profiles entry</li>
          <li>🔍 Verify everything is synced</li>
        </ul>
        
        <button
          onClick={createFreshCleaner}
          disabled={loading}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Creating Fresh Cleaner...' : '🧹 Create Fresh Cleaner'}
        </button>
      </div>

      {result && (
        <div className={`border rounded-lg p-6 mb-6 ${
          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h3 className="font-semibold mb-4">Result:</h3>
          
          {result.success ? (
            <div className="space-y-4">
              <div className="mb-4">
                <h4 className="font-medium text-green-800 mb-2">✅ Fresh Cleaner Created Successfully!</h4>
                <p className="text-green-700">{result.message}</p>
              </div>

              {result.cleaner && (
                <div className="bg-white border rounded p-4">
                  <h5 className="font-medium mb-3">👤 Cleaner Details:</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p><strong>Auth ID:</strong> {result.cleaner.authId}</p>
                      <p><strong>Email:</strong> {result.cleaner.email}</p>
                      <p><strong>Role:</strong> {result.cleaner.profile?.role}</p>
                      <p><strong>Name:</strong> {result.cleaner.profile?.first_name} {result.cleaner.profile?.last_name}</p>
                    </div>
                    <div>
                      {result.cleaner.cleanerProfile && (
                        <>
                          <p><strong>Hourly Rate:</strong> ${result.cleaner.cleanerProfile.hourly_rate}</p>
                          <p><strong>Experience:</strong> {result.cleaner.cleanerProfile.experience_years} years</p>
                          <p><strong>Rating:</strong> {result.cleaner.cleanerProfile.rating}★</p>
                          <p><strong>Available:</strong> {result.cleaner.cleanerProfile.is_available ? 'Yes' : 'No'}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {result.credentials && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                  <h5 className="font-medium mb-3">🔑 Test Login Credentials:</h5>
                  <div className="bg-yellow-100 p-3 rounded font-mono">
                    <p><strong>Email:</strong> {result.credentials.email}</p>
                    <p><strong>Password:</strong> {result.credentials.password}</p>
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
                          <div key={index}>• {user.email} (ID: {user.id})</div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <strong className="text-purple-800">Database Profiles:</strong>
                      <div className="text-sm text-gray-600">
                        {result.verification.profiles.map((profile: any, index: number) => (
                          <div key={index}>• {profile.email} ({profile.role}) - ID: {profile.id}</div>
                        ))}
                      </div>
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
                  href="/cleaner-dashboard" 
                  className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 inline-block"
                >
                  Cleaner Dashboard
                </a>
                <a 
                  href="/auth-debug" 
                  className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 inline-block"
                >
                  Auth Debug
                </a>
                <a 
                  href="/list-users" 
                  className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 inline-block"
                >
                  List All Users
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
          <li>Deletes any existing cleaner data to avoid conflicts</li>
          <li>Creates fresh auth user with cleanertest@nexxus.com</li>
          <li>Creates matching user_profiles entry with role 'cleaner'</li>
          <li>Creates cleaner_profiles entry with default values</li>
          <li>Ensures perfect ID synchronization between auth and database</li>
          <li>Provides test credentials for immediate login testing</li>
        </ul>
        
        <div className="mt-4 p-3 bg-primary-100 rounded">
          <p className="text-primary-800 font-medium">🎯 Test Flow:</p>
          <ol className="text-primary-700 list-decimal list-inside mt-1">
            <li>Click "Create Fresh Cleaner"</li>
            <li>Copy the test credentials</li>
            <li>Go to Login page</li>
            <li>Login as cleanertest@nexxus.com</li>
            <li>Navigate to Cleaner Dashboard</li>
            <li>Verify everything works!</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
