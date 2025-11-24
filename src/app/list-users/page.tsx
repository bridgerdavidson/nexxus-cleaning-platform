'use client';

import { useState } from 'react';

export default function ListUsers() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const listUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/list-auth-users', {
        method: 'GET',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to list users', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">List All Users</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">Diagnostic Tool</h2>
        <p className="text-primary-700 mb-4">
          This will list all auth users and profiles to help us identify the correct UIDs.
        </p>
        <button
          onClick={listUsers}
          disabled={loading}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Loading Users...' : 'List All Users'}
        </button>
      </div>

      {result && (
        <div className={`border rounded-lg p-4 mb-6 ${
          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h3 className="font-semibold mb-2">Result:</h3>
          
          {result.success && result.data ? (
            <div className="space-y-4">
              <div className="bg-white border rounded p-4">
                <h4 className="font-medium text-green-800 mb-3">📊 Summary</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong>Total Auth Users:</strong> {result.data.summary.totalAuthUsers}
                  </div>
                  <div>
                    <strong>Total Profiles:</strong> {result.data.summary.totalProfiles}
                  </div>
                  <div>
                    <strong>Auth Emails:</strong> {result.data.summary.authEmails.join(', ')}
                  </div>
                  <div>
                    <strong>Profile Emails:</strong> {result.data.summary.profileEmails.join(', ')}
                  </div>
                </div>
              </div>

              <div className="bg-white border rounded p-4">
                <h4 className="font-medium text-primary-800 mb-3">🔐 Auth Users</h4>
                <div className="space-y-2">
                  {result.data.authUsers.map((user: any, index: number) => (
                    <div key={index} className="bg-primary-50 p-3 rounded border">
                      <div className="font-mono text-sm">
                        <strong>ID:</strong> {user.id}
                      </div>
                      <div className="text-sm">
                        <strong>Email:</strong> {user.email}
                      </div>
                      <div className="text-xs text-gray-600">
                        Created: {new Date(user.created_at).toLocaleString()}
                      </div>
                      {user.email_confirmed_at && (
                        <div className="text-xs text-green-600">
                          ✅ Email confirmed: {new Date(user.email_confirmed_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border rounded p-4">
                <h4 className="font-medium text-purple-800 mb-3">👤 Database Profiles</h4>
                <div className="space-y-2">
                  {result.data.profiles.map((profile: any, index: number) => (
                    <div key={index} className="bg-purple-50 p-3 rounded border">
                      <div className="font-mono text-sm">
                        <strong>Profile ID:</strong> {profile.id}
                      </div>
                      <div className="text-sm">
                        <strong>Email:</strong> {profile.email}
                      </div>
                      <div className="text-sm">
                        <strong>Role:</strong> {profile.role}
                      </div>
                      <div className="text-sm">
                        <strong>Name:</strong> {profile.first_name} {profile.last_name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-red-700">
              <p><strong>Error:</strong> {result.error}</p>
              {result.details && <p><strong>Details:</strong> {result.details}</p>}
            </div>
          )}
          
          <details className="mt-4">
            <summary className="cursor-pointer font-medium">View Raw Response</summary>
            <pre className="text-sm overflow-auto whitespace-pre-wrap mt-2 bg-gray-100 p-2 rounded">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
