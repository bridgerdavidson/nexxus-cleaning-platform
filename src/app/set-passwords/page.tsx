'use client';

import { useState } from 'react';

export default function SetPasswords() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const setPasswords = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/set-passwords', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to set passwords', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Set User Passwords</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">Admin SDK Password Setting</h2>
        <p className="text-primary-700 mb-4">
          This will use the Supabase Admin SDK to set passwords for existing auth users:
        </p>
        <ul className="text-primary-700 mb-4 list-disc list-inside space-y-1">
          <li><strong>homeowner@nexxus.com</strong> → Password: Homeowner123!</li>
          <li><strong>cleaner@nexxus.com</strong> → Password: Cleaner123!</li>
        </ul>
        <p className="text-primary-700 mb-4">
          This uses the service role key to directly update user passwords.
        </p>
        <button
          onClick={setPasswords}
          disabled={loading}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Setting Passwords...' : 'Set Passwords with Admin SDK'}
        </button>
      </div>

      {result && (
        <div className={`border rounded-lg p-4 mb-6 ${
          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h3 className="font-semibold mb-2">Result:</h3>
          
          {result.success ? (
            <div className="mb-4">
              <h4 className="font-medium text-green-800 mb-2">✅ Passwords Set Successfully!</h4>
              
              {result.testCredentials && (
                <div className="bg-white border rounded p-4 mb-4">
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

              <div className="flex gap-3">
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
          <li>Uses Supabase Admin SDK with service role key</li>
          <li>Directly updates user passwords in auth.users table</li>
          <li>Sets user metadata (first_name, last_name, role)</li>
          <li>Verifies the users exist before attempting updates</li>
          <li>Provides detailed success/error feedback</li>
        </ul>
      </div>
    </div>
  );
}
