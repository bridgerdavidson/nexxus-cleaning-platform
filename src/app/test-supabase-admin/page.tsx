'use client';

import { useState } from 'react';

export default function TestSupabaseAdmin() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testConnection = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/test-supabase-admin', {
        method: 'POST',
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to test connection', details: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Test Supabase Admin Connection</h1>
      
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-primary-800 mb-2">Connection Test</h2>
        <p className="text-primary-700 mb-4">
          This will test if our Supabase Admin API connection is working properly.
        </p>
        <button
          onClick={testConnection}
          disabled={loading}
          className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {result && (
        <div className="bg-gray-50 border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Result:</h3>
          <pre className="text-sm overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
