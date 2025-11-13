import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    // 🔍 DEBUG: Check environment variables
    console.log('🔍 === ENVIRONMENT DEBUG ===');
    console.log('🔍 SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log('🔍 HAS_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('🔍 SERVICE_KEY_START:', process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20));
    console.log('🔍 === END DEBUG ===');
    
    const body = await request.json();
    const { email, password, firstName, lastName, role } = body;

    // Log what we received
    console.log('📥 Signup request received:', { 
      email, 
      firstName, 
      lastName, 
      role,
      roleType: typeof role 
    });

    // Validate inputs
    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate role - be explicit about what we're doing
    const validRoles = ['homeowner', 'cleaner', 'admin', 'manager'];
    const userRole = role && validRoles.includes(role) ? role : 'homeowner';
    
    console.log('✅ Role validation:', { 
      receivedRole: role,
      finalRole: userRole,
      isValid: validRoles.includes(role)
    });

    // Use admin client to create user with app_metadata (secure)
    const createUserPayload = {
      email,
      password,
      email_confirm: true, // Auto-confirm email for development
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
      },
      app_metadata: {
        role: userRole, // Role in app_metadata - only settable by service role
      },
    };

    console.log('🚀 Creating user with payload:', {
      email: createUserPayload.email,
      user_metadata: createUserPayload.user_metadata,
      app_metadata: createUserPayload.app_metadata
    });

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser(createUserPayload);

    if (authError) {
      console.error('❌ Signup error:', authError);
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      );
    }

    console.log('✅ User created successfully:', {
      userId: authData.user.id,
      email: authData.user.email,
      app_metadata: authData.user.app_metadata
    });

    // Wait a moment for trigger to run
    await new Promise(resolve => setTimeout(resolve, 100));

    // Update the profile to ensure role is correct (handles timing issues)
    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        id: authData.user.id,
        email: email,
        first_name: firstName,
        last_name: lastName,
        role: userRole,
      }, {
        onConflict: 'id'
      });

    if (updateError) {
      console.error('⚠️ Profile update error:', updateError);
      // Don't fail the signup, just log it
    } else {
      console.log('✅ Profile role confirmed:', userRole);
    }

    // If user is a cleaner, create their cleaner profile
    if (userRole === 'cleaner') {
      console.log('🧹 Creating cleaner profile...');
      
      const { error: cleanerProfileError } = await supabaseAdmin
        .from('cleaner_profiles')
        .insert({
          id: authData.user.id,
          // All other fields have defaults:
          // rating: 0.00, total_jobs: 0, is_available: true, etc.
        });

      if (cleanerProfileError) {
        console.error('⚠️ Cleaner profile creation error:', cleanerProfileError);
        // Don't fail the signup, but log the error
      } else {
        console.log('✅ Cleaner profile created successfully');
      }
    }

    return NextResponse.json({
      success: true,
      message: 'User created successfully',
      userId: authData.user.id,
      role: userRole, // Return the role for verification
    });
  } catch (error) {
    console.error('❌ Unexpected signup error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during signup' },
      { status: 500 }
    );
  }
}

