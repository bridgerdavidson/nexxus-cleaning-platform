'use client';

import { useState } from 'react';

export default function SimpleUserCreationPage() {
  const [copied, setCopied] = useState<string>('');

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(''), 2000);
  };

  const checkExistingUsersSQL = `-- Check what users already exist
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at,
  p.first_name,
  p.last_name,
  p.role
FROM auth.users u
LEFT JOIN public.user_profiles p ON u.id = p.id
WHERE u.email IN ('homeowner@nexxus.com', 'cleaner@nexxus.com', 'admin@nexxus.com')
ORDER BY u.email;`;

  const deleteExistingSQL = `-- Delete existing users if they exist (OPTIONAL - only if you want to start fresh)
DELETE FROM public.user_profiles WHERE email IN ('homeowner@nexxus.com', 'cleaner@nexxus.com');
DELETE FROM auth.users WHERE email IN ('homeowner@nexxus.com', 'cleaner@nexxus.com');`;

  const createUsersSQL = `-- Create both users at once
DO $$
DECLARE
    homeowner_id UUID;
    cleaner_id UUID;
BEGIN
    -- Create Homeowner User
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
    ) ON CONFLICT (email) DO NOTHING
    RETURNING id INTO homeowner_id;

    -- Get homeowner ID if it already existed
    IF homeowner_id IS NULL THEN
        SELECT id INTO homeowner_id FROM auth.users WHERE email = 'homeowner@nexxus.com';
    END IF;

    -- Create Cleaner User
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
    ) ON CONFLICT (email) DO NOTHING
    RETURNING id INTO cleaner_id;

    -- Get cleaner ID if it already existed
    IF cleaner_id IS NULL THEN
        SELECT id INTO cleaner_id FROM auth.users WHERE email = 'cleaner@nexxus.com';
    END IF;

    -- Create or update homeowner profile
    INSERT INTO public.user_profiles (
        id,
        email,
        first_name,
        last_name,
        role,
        created_at,
        updated_at
    ) VALUES (
        homeowner_id,
        'homeowner@nexxus.com',
        'John',
        'Homeowner',
        'homeowner'::user_role,
        NOW(),
        NOW()
    ) ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        role = EXCLUDED.role,
        updated_at = NOW();

    -- Create or update cleaner profile
    INSERT INTO public.user_profiles (
        id,
        email,
        first_name,
        last_name,
        role,
        created_at,
        updated_at
    ) VALUES (
        cleaner_id,
        'cleaner@nexxus.com',
        'Jane',
        'Cleaner',
        'cleaner'::user_role,
        NOW(),
        NOW()
    ) ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        role = EXCLUDED.role,
        updated_at = NOW();

    RAISE NOTICE 'Users created/updated successfully!';
END $$;`;

  const verificationSQL = `-- Verify all users exist and can login
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at IS NOT NULL as can_login,
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
        <h1 className="text-3xl font-bold mb-6">Simple User Creation (Fixed)</h1>
        
        <div className="bg-red-50 border border-red-200 p-4 rounded mb-6">
          <h2 className="font-semibold text-red-800">Error Fixed!</h2>
          <p className="text-red-700">
            The previous error was due to duplicate profiles. This new approach handles existing users properly 
            and uses ON CONFLICT to avoid duplicate key errors.
          </p>
        </div>

        <div className="space-y-8">
          {/* Check Existing Users */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800">1. Check Existing Users (Optional)</h3>
              <button
                onClick={() => copyToClipboard(checkExistingUsersSQL, 'check')}
                className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
              >
                {copied === 'check' ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
              <code>{checkExistingUsersSQL}</code>
            </pre>
          </div>

          {/* Delete Existing (Optional) */}
          <div className="bg-white border border-yellow-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-yellow-800">2. Delete Existing Users (OPTIONAL)</h3>
              <button
                onClick={() => copyToClipboard(deleteExistingSQL, 'delete')}
                className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
              >
                {copied === 'delete' ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
            <p className="text-yellow-700 mb-4">⚠️ Only run this if you want to completely start fresh!</p>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
              <code>{deleteExistingSQL}</code>
            </pre>
          </div>

          {/* Create Users */}
          <div className="bg-white border border-green-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-green-800">3. Create/Update Both Users</h3>
              <button
                onClick={() => copyToClipboard(createUsersSQL, 'create')}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                {copied === 'create' ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
            <p className="text-green-700 mb-4">✅ This handles duplicates safely with ON CONFLICT!</p>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
              <code>{createUsersSQL}</code>
            </pre>
          </div>

          {/* Verification SQL */}
          <div className="bg-white border border-primary-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-primary-800">4. Verify Users Created</h3>
              <button
                onClick={() => copyToClipboard(verificationSQL, 'verify')}
                className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700"
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
              <li>Go to your Supabase dashboard → SQL Editor</li>
              <li>Run the "Create/Update Both Users" SQL (step 3)</li>
              <li>Run the verification query to confirm users exist</li>
              <li>Test the login credentials on your app</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
