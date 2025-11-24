'use client';

import { useState } from 'react';

export default function UpdateProfiles() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runUpdate = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/update-profile-ids', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to update profiles', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Update Profile IDs</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">Step 1: Update Database Profile IDs</h2>
        <p className="text-primary-700 mb-4">
          This will update the user_profiles table to use the correct auth user IDs:
        </p>
        <ul className="text-primary-700 mb-4 list-disc list-inside space-y-1">
          <li><strong>homeowner@nexxus.com</strong> → UID: d811e717-8807-4cfd-928f-eb827b67ce87</li>
          <li><strong>cleaner@nexxus.com</strong> → UID: 71f7a3c8-6072-4dae-87a8-210d51d2fca2</li>
        </ul>
        <p className="text-primary-700 mb-4">
          After this, you'll need to manually set passwords in the Supabase dashboard.
        </p>
        <button
          onClick={runUpdate}
          disabled={loading}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Updating Profiles...' : 'Update Profile IDs'}
        </button>
      </div>

      {result && (
        <div className={`border rounded-lg p-4 mb-6 ${
          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h3 className="font-semibold mb-2">Result:</h3>
          
          {result.success && result.nextSteps && (
            <div className="mb-4">
              <h4 className="font-medium text-green-800 mb-2">✅ Profile IDs Updated Successfully!</h4>
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                <h5 className="font-medium text-yellow-800 mb-2">Next Steps - Manual Password Setup:</h5>
                <ol className="text-yellow-700 list-decimal list-inside space-y-1">
                  {result.nextSteps.map((step: string, index: number) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </div>
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

      {result?.success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-green-800 mb-2">Ready for Testing!</h3>
          <p className="text-green-700 mb-4">
            Once you've set the passwords in Supabase dashboard, test the login:
          </p>
          <div className="space-y-2">
            <div className="bg-white p-3 rounded border">
              <strong>Homeowner Login:</strong><br />
              Email: homeowner@nexxus.com<br />
              Password: Homeowner123!
            </div>
            <div className="bg-white p-3 rounded border">
              <strong>Cleaner Login:</strong><br />
              Email: cleaner@nexxus.com<br />
              Password: Cleaner123!
            </div>
            <div className="bg-white p-3 rounded border">
              <strong>Admin Login:</strong><br />
              Email: admin@nexxus.com<br />
              Password: Admin123!
            </div>
          </div>
          <div className="mt-4">
            <a 
              href="/login" 
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 inline-block"
            >
              Test Login →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
