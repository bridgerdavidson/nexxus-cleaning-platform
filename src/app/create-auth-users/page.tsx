'use client';

import { useState } from 'react';

export default function CreateAuthUsers() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const createMissingAuthUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/create-missing-auth-users', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to create missing auth users', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Create Missing Auth Users</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">Problem Identified</h2>
        <p className="text-primary-700 mb-4">
          We have user profiles in the database but missing corresponding auth users in Supabase Auth.
        </p>
        <p className="text-primary-700 mb-4">
          This will:
        </p>
        <ul className="text-primary-700 mb-4 list-disc list-inside">
          <li>Find profiles without corresponding auth users</li>
          <li>Create auth users for homeowner@nexxus.com and cleaner@nexxus.com</li>
          <li>Link the auth users to existing profiles</li>
          <li>Set correct passwords (Homeowner123! and Cleaner123!)</li>
        </ul>
        <button
          onClick={createMissingAuthUsers}
          disabled={loading}
          className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? 'Creating Auth Users...' : 'Create Missing Auth Users'}
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
