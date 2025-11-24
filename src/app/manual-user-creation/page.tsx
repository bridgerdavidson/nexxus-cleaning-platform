'use client';

import { useState } from 'react';

export default function ManualUserCreationPage() {
  const [copied, setCopied] = useState<string>('');

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(''), 2000);
  };

  const homeownerSQL = `-- Create Homeowner User
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'homeowner@nexxus.com',
  crypt('Homeowner123!', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
);

-- Get the user ID and create profile
WITH new_user AS (
  SELECT id FROM auth.users WHERE email = 'homeowner@nexxus.com'
)
INSERT INTO public.user_profiles (
  id,
  email,
  first_name,
  last_name,
  role,
  created_at,
  updated_at
)
SELECT 
  id,
  'homeowner@nexxus.com',
  'John',
  'Homeowner',
  'homeowner'::user_role,
  NOW(),
  NOW()
FROM new_user;`;

  const cleanerSQL = `-- Create Cleaner User
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'cleaner@nexxus.com',
  crypt('Cleaner123!', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
);

-- Get the user ID and create profile
WITH new_user AS (
  SELECT id FROM auth.users WHERE email = 'cleaner@nexxus.com'
)
INSERT INTO public.user_profiles (
  id,
  email,
  first_name,
  last_name,
  role,
  created_at,
  updated_at
)
SELECT 
  id,
  'cleaner@nexxus.com',
  'Jane',
  'Cleaner',
  'cleaner'::user_role,
  NOW(),
  NOW()
FROM new_user;`;

  const verificationSQL = `-- Verify users were created
SELECT 
  u.email,
  u.email_confirmed_at,
  p.first_name,
  p.last_name,
  p.role
FROM auth.users u
LEFT JOIN public.user_profiles p ON u.id = p.id
WHERE u.email IN ('homeowner@nexxus.com', 'cleaner@nexxus.com', 'admin@nexxus.com')
ORDER BY u.email;`;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Manual User Creation</h1>
        
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded mb-6">
          <h2 className="font-semibold text-yellow-800">Instructions</h2>
          <p className="text-yellow-700">
            Since automatic user creation is failing, you need to run these SQL commands manually in your Supabase SQL Editor.
            Go to your Supabase dashboard → SQL Editor → New Query, then copy and paste each SQL block below.
          </p>
        </div>

        <div className="space-y-8">
          {/* Homeowner SQL */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800">1. Create Homeowner User</h3>
              <button
                onClick={() => copyToClipboard(homeownerSQL, 'homeowner')}
                className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700"
              >
                {copied === 'homeowner' ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
              <code>{homeownerSQL}</code>
            </pre>
          </div>

          {/* Cleaner SQL */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800">2. Create Cleaner User</h3>
              <button
                onClick={() => copyToClipboard(cleanerSQL, 'cleaner')}
                className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700"
              >
                {copied === 'cleaner' ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
              <code>{cleanerSQL}</code>
            </pre>
          </div>

          {/* Verification SQL */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800">3. Verify Users Created</h3>
              <button
                onClick={() => copyToClipboard(verificationSQL, 'verify')}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                {copied === 'verify' ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
              <code>{verificationSQL}</code>
            </pre>
          </div>

          {/* Test Credentials */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h3 className="text-xl font-semibold text-green-800 mb-4">Test Credentials</h3>
            <div className="space-y-2 text-green-700">
              <p><strong>Admin:</strong> admin@nexxus.com / Admin123!</p>
              <p><strong>Homeowner:</strong> homeowner@nexxus.com / Homeowner123!</p>
              <p><strong>Cleaner:</strong> cleaner@nexxus.com / Cleaner123!</p>
            </div>
          </div>

          {/* Next Steps */}
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-6">
            <h3 className="text-xl font-semibold text-primary-800 mb-4">Next Steps</h3>
            <ol className="list-decimal list-inside space-y-2 text-primary-700">
              <li>Go to your Supabase dashboard</li>
              <li>Navigate to SQL Editor</li>
              <li>Click "New Query"</li>
              <li>Copy and paste the Homeowner SQL, then click "Run"</li>
              <li>Create another new query for the Cleaner SQL, then click "Run"</li>
              <li>Run the verification query to confirm both users were created</li>
              <li>Test the login credentials on your app</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
