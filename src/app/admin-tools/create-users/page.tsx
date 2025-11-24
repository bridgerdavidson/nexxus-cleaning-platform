'use client';

import { useState } from 'react';

interface UserResult {
  success: boolean;
  message: string;
  exists: boolean;
}

interface ApiResponse {
  success: boolean;
  results: {
    homeowner: UserResult;
    cleaner: UserResult;
  };
  message: string;
  error?: string;
  details?: string;
}

export default function AdminCreateUsersPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);

  const createUsers = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const response = await fetch('/api/admin/create-missing-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data: ApiResponse = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        results: {
          homeowner: { success: false, message: '', exists: false },
          cleaner: { success: false, message: '', exists: false }
        },
        message: 'Failed to call API',
        error: String(error)
      });
    } finally {
      setLoading(false);
    }
  };

  const testLogin = async (email: string, password: string) => {
    try {
      const response = await fetch('/api/auth/test-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await response.json();
      return data.success;
    } catch (error) {
      return false;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Admin User Creation Tool</h1>
        
        <div className="bg-primary-50 border border-primary-200 p-4 rounded mb-6">
          <h2 className="font-semibold text-primary-800">Secure Server-Side User Creation</h2>
          <p className="text-primary-700">
            This tool uses the Supabase Admin API (server-side only) to create missing test users.
            The service role key is never exposed to the client.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h3 className="text-xl font-semibold mb-4">Create Missing Users</h3>
          <p className="text-gray-600 mb-4">
            This will create or verify the following test users:
          </p>
          <ul className="list-disc list-inside space-y-1 text-gray-700 mb-6">
            <li><strong>Homeowner:</strong> homeowner@nexxus.com / Homeowner123!</li>
            <li><strong>Cleaner:</strong> cleaner@nexxus.com / Cleaner123!</li>
          </ul>
          
          <button
            onClick={createUsers}
            disabled={loading}
            className="bg-green-600 text-white px-6 py-3 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating Users...' : 'Create/Verify Users'}
          </button>
        </div>

        {result && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">Results</h3>
            
            {result.error ? (
              <div className="bg-red-50 border border-red-200 p-4 rounded mb-4">
                <h4 className="font-semibold text-red-800">Error</h4>
                <p className="text-red-700">{result.error}</p>
                {result.details && (
                  <pre className="text-sm text-red-600 mt-2">{result.details}</pre>
                )}
              </div>
            ) : (
              <>
                <div className={`p-4 rounded mb-4 ${result.success ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <h4 className={`font-semibold ${result.success ? 'text-green-800' : 'text-yellow-800'}`}>
                    {result.success ? '✅ Success!' : '⚠️ Partial Success'}
                  </h4>
                  <p className={result.success ? 'text-green-700' : 'text-yellow-700'}>
                    {result.message}
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Homeowner Result */}
                  <div className={`p-4 rounded ${result.results.homeowner.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <h5 className={`font-semibold ${result.results.homeowner.success ? 'text-green-800' : 'text-red-800'}`}>
                      {result.results.homeowner.success ? '✅' : '❌'} Homeowner User
                    </h5>
                    <p className={result.results.homeowner.success ? 'text-green-700' : 'text-red-700'}>
                      {result.results.homeowner.message}
                    </p>
                    {result.results.homeowner.exists && (
                      <span className="text-sm text-gray-600">(User already existed)</span>
                    )}
                  </div>

                  {/* Cleaner Result */}
                  <div className={`p-4 rounded ${result.results.cleaner.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <h5 className={`font-semibold ${result.results.cleaner.success ? 'text-green-800' : 'text-red-800'}`}>
                      {result.results.cleaner.success ? '✅' : '❌'} Cleaner User
                    </h5>
                    <p className={result.results.cleaner.success ? 'text-green-700' : 'text-red-700'}>
                      {result.results.cleaner.message}
                    </p>
                    {result.results.cleaner.exists && (
                      <span className="text-sm text-gray-600">(User already existed)</span>
                    )}
                  </div>
                </div>

                {result.success && (
                  <div className="mt-6 bg-primary-50 border border-primary-200 p-4 rounded">
                    <h4 className="font-semibold text-primary-800 mb-2">Next Steps</h4>
                    <ol className="list-decimal list-inside space-y-1 text-primary-700">
                      <li>Go to your login page: <a href="/login" className="underline hover:text-primary-800">/login</a></li>
                      <li>Test the homeowner credentials: homeowner@nexxus.com / Homeowner123!</li>
                      <li>Test the cleaner credentials: cleaner@nexxus.com / Cleaner123!</li>
                      <li>Verify that both users can access their respective dashboards</li>
                    </ol>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-8 bg-gray-50 border border-gray-200 p-4 rounded">
          <h4 className="font-semibold text-gray-800 mb-2">Security Notes</h4>
          <ul className="list-disc list-inside space-y-1 text-gray-600 text-sm">
            <li>This tool only works in development mode</li>
            <li>The service role key is stored server-side only</li>
            <li>No admin credentials are exposed to the client</li>
            <li>Users are created using official Supabase Admin API</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
