'use client';

import { useState } from 'react';

export default function SyncUsers() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runSync = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/sync-existing-users', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to sync users', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Sync Existing Auth Users</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">Using Existing Auth Users</h2>
        <p className="text-primary-700 mb-4">
          Based on your Supabase dashboard, we found these existing auth users:
        </p>
        <ul className="text-primary-700 mb-4 list-disc list-inside space-y-1">
          <li><strong>homeowner@nexxus.com</strong> - UID: d811e717-8807-4cfd-928f-eb827b67ce87</li>
          <li><strong>cleaner@nexxus.com</strong> - UID: 71f7a3c8-6072-4dae-87a8-210d51d2fca2</li>
        </ul>
        <p className="text-primary-700 mb-4">
          This will:
        </p>
        <ol className="text-primary-700 mb-4 list-decimal list-inside space-y-1">
          <li>Update homeowner profile to use UID d811e717-8807-4cfd-928f-eb827b67ce87</li>
          <li>Update cleaner profile to use UID 71f7a3c8-6072-4dae-87a8-210d51d2fca2</li>
          <li>Set password "Homeowner123!" for homeowner user</li>
          <li>Set password "Cleaner123!" for cleaner user</li>
          <li>Verify all connections work properly</li>
        </ol>
        <p className="text-primary-700 mb-4 font-medium">
          After this, all three users should be able to login successfully!
        </p>
        <button
          onClick={runSync}
          disabled={loading}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
        >
          {loading ? 'Syncing Users...' : 'Sync Existing Users'}
        </button>
      </div>

      {result && (
        <div className={`border rounded-lg p-4 ${
          result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <h3 className="font-semibold mb-2">Result:</h3>
          <pre className="text-sm overflow-auto whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
