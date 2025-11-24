'use client';

import { useState } from 'react';

export default function FixRLSAndAuthPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runFix = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/disable-rls-simple', {
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Fix RLS & Authentication</h1>
          
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold text-primary-900 mb-4">🔧 RLS Bypass & User Creation</h2>
            <p className="text-primary-800 mb-4">
              This will bypass RLS restrictions and create test users for all three roles:
            </p>
            <ul className="list-disc list-inside text-primary-800 space-y-2 mb-6">
              <li>🧹 Clean up any existing test users and profiles</li>
              <li>🧪 Test basic user creation functionality</li>
              <li>👤 Create admin, cleaner, and homeowner users</li>
              <li>📝 Create profiles manually if trigger fails</li>
              <li>🔧 Create cleaner-specific profiles</li>
              <li>✅ Verify all data access works correctly</li>
            </ul>
            
            <button
              onClick={runFix}
              disabled={loading}
              className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '🔄 Running Fix...' : '🔧 Fix RLS & Create Users'}
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
                  
                  <div className="space-y-6">
                    {/* Summary */}
                    <div className="bg-white p-4 rounded border">
                      <h4 className="font-semibold text-green-800 mb-2">📊 Summary:</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-green-700 text-sm">
                        <div>
                          <p><strong>User Creation:</strong> {result.summary.userCreationWorks ? '✅' : '❌'}</p>
                        </div>
                        <div>
                          <p><strong>Trigger Works:</strong> {result.summary.triggerWorks ? '✅' : '❌'}</p>
                        </div>
                        <div>
                          <p><strong>Users Created:</strong> {result.summary.usersCreated}</p>
                        </div>
                        <div>
                          <p><strong>Errors:</strong> {result.summary.userCreationErrors}</p>
                        </div>
                      </div>
                    </div>

                    {/* Credentials */}
                    {result.credentials && result.credentials.length > 0 && (
                      <div className="bg-white p-4 rounded border">
                        <h4 className="font-semibold text-green-800 mb-2">🔑 Test Credentials:</h4>
                        <div className="space-y-2">
                          {result.credentials.map((cred: any, index: number) => (
                            <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded">
                              <div>
                                <span className="font-medium text-gray-900">{cred.role.toUpperCase()}</span>
                                <span className="text-gray-600 ml-2">{cred.email}</span>
                              </div>
                              <div className="text-sm text-gray-500">
                                Password: <code className="bg-gray-200 px-1 rounded">{cred.password}</code>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Access Tests */}
                    {result.details?.accessTests && (
                      <div className="bg-white p-4 rounded border">
                        <h4 className="font-semibold text-green-800 mb-2">🔍 Data Access Tests:</h4>
                        <div className="space-y-2">
                          {result.details.accessTests.map((test: any, index: number) => (
                            <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                              <span className="text-sm">
                                <strong>{test.role}</strong> ({test.email})
                              </span>
                              <span className={`text-sm ${test.profileAccess ? 'text-green-600' : 'text-red-600'}`}>
                                {test.profileAccess ? '✅ Profile Access' : '❌ No Access'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Database State */}
                    <div className="bg-white p-4 rounded border">
                      <h4 className="font-semibold text-green-800 mb-2">🗄️ Database State:</h4>
                      <div className="grid grid-cols-3 gap-4 text-green-700 text-sm">
                        <div>
                          <p><strong>Auth Users:</strong> {result.summary.totalAuthUsers}</p>
                        </div>
                        <div>
                          <p><strong>Profiles:</strong> {result.summary.totalProfiles}</p>
                        </div>
                        <div>
                          <p><strong>Cleaner Profiles:</strong> {result.summary.totalCleanerProfiles}</p>
                        </div>
                      </div>
                    </div>

                    {/* Next Steps */}
                    <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                      <h4 className="font-semibold text-primary-800 mb-2">🚀 Next Steps:</h4>
                      <ol className="list-decimal list-inside text-primary-700 text-sm space-y-1">
                        {result.nextSteps?.map((step: string, index: number) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                    </div>

                    {/* Errors */}
                    {result.details?.userErrors && result.details.userErrors.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <h4 className="font-semibold text-red-800 mb-2">❌ Errors:</h4>
                        <div className="space-y-2">
                          {result.details.userErrors.map((error: any, index: number) => (
                            <div key={index} className="text-red-700 text-sm">
                              <strong>{error.role} ({error.email}):</strong> {error.error}
                              {error.step && <span className="text-red-500"> (Step: {error.step})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                  </div>
                </div>
              )}

              <details className="mt-6">
                <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                  📋 View Full Response
                </summary>
                <pre className="mt-4 bg-gray-100 p-4 rounded-lg text-sm overflow-auto max-h-96">
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
