'use client';

import { useState } from 'react';

export default function TestAdminConnectionPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testConnection = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/test-admin-connection', {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Test Admin Connection</h1>
          
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold text-primary-900 mb-4">🔧 Admin Connection Test</h2>
            <p className="text-primary-800 mb-4">
              This will test the Supabase admin connection by:
            </p>
            <ul className="list-disc list-inside text-primary-800 space-y-2">
              <li>📋 Listing existing auth users</li>
              <li>🗄️ Querying the database</li>
              <li>👤 Creating a test user</li>
              <li>🗑️ Cleaning up the test user</li>
            </ul>
            
            <button
              onClick={testConnection}
              disabled={loading}
              className="mt-6 bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '🔄 Testing...' : '🧪 Test Admin Connection'}
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
                  
                  <div className="space-y-2 text-green-700">
                    <p><strong>Auth Users:</strong> {result.results.userCount}</p>
                    <p><strong>Database Profiles:</strong> {result.results.profileCount}</p>
                    <p><strong>Test User Created:</strong> {result.results.testUserCreated ? '✅' : '❌'}</p>
                    <p><strong>Test User Deleted:</strong> {result.results.testUserDeleted ? '✅' : '❌'}</p>
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
                    {result.test && <p><strong>Failed Test:</strong> {result.test}</p>}
                    {result.testEmail && <p><strong>Test Email:</strong> {result.testEmail}</p>}
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
