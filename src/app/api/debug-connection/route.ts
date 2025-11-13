import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  const results: any = {
    timestamp: new Date().toISOString(),
    checks: {},
  };

  // Check 1: Environment variables
  results.checks.environmentVariables = {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    anonKeyPreview: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 20) + '...',
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleKeyPreview: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...',
  };

  // Check 2: Can we connect to database?
  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('count', { count: 'exact', head: true });
    
    results.checks.databaseConnection = {
      success: !error,
      error: error?.message || null,
    };
  } catch (err: any) {
    results.checks.databaseConnection = {
      success: false,
      error: err.message,
    };
  }

  // Check 3: Can we use auth admin?
  try {
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    
    results.checks.authAdmin = {
      success: !error,
      error: error?.message || null,
      userCount: users?.users?.length || 0,
    };
  } catch (err: any) {
    results.checks.authAdmin = {
      success: false,
      error: err.message,
    };
  }

  // Check 4: Check if function exists
  // We'll skip this check since it's complex - user already ran verify-schema.sql
  results.checks.handleNewUserFunction = {
    note: 'Run verify-schema.sql to check this - you already did and it passed ✅',
  };

  // Check 5: Try creating a test user (but don't actually create)
  results.checks.userCreationTest = {
    note: 'To test actual user creation, POST to /api/debug-connection with email in body',
  };

  // Overall status
  const allChecksPassed = 
    results.checks.environmentVariables.hasSupabaseUrl &&
    results.checks.environmentVariables.hasServiceRoleKey &&
    results.checks.databaseConnection.success &&
    results.checks.authAdmin.success;

  results.overallStatus = allChecksPassed ? 'HEALTHY ✅' : 'ISSUES FOUND ❌';

  return NextResponse.json(results, { 
    status: allChecksPassed ? 200 : 500,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return NextResponse.json({
        success: false,
        error: 'Email is required',
      }, { status: 400 });
    }

    console.log('🧪 Testing user creation for:', email);
    console.log('🔍 Using Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

    // Try to create a minimal user
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: {
        first_name: 'Debug',
        last_name: 'Test',
      },
      app_metadata: {
        role: 'homeowner',
      },
    });

    if (error) {
      console.error('❌ User creation failed:', error);
      return NextResponse.json({
        success: false,
        error: {
          message: error.message,
          status: error.status,
          code: (error as any).code,
        },
      }, { status: 400 });
    }

    console.log('✅ User created successfully:', data.user?.id);

    // Check if profile was created by trigger
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', data.user!.id)
      .single();

    return NextResponse.json({
      success: true,
      user: {
        id: data.user?.id,
        email: data.user?.email,
      },
      profile: {
        exists: !profileError && !!profile,
        data: profile || null,
        error: profileError?.message || null,
      },
      note: 'User created successfully. Check your dev database to verify.',
    });

  } catch (err: any) {
    console.error('❌ Exception during user creation:', err);
    return NextResponse.json({
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
      },
    }, { status: 500 });
  }
}

