import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, firstName, lastName, role } = body;

    // Validate inputs
    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // SECURITY: public self-service signup may only create homeowner accounts.
    // Staff roles (cleaner/manager/admin/owner) are provisioned exclusively through
    // the authenticated invite flow (admin/send-invite -> accept-invite). Previously
    // this route honored a client-supplied `role`, letting any visitor self-assign
    // admin/manager of a live organization.
    if (role && role !== 'homeowner') {
      return NextResponse.json(
        {
          error:
            'Staff accounts are created by invitation only. Please ask an organization admin to invite you.',
        },
        { status: 403 }
      );
    }
    const userRole = 'homeowner';

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

    // Get or create Default Organization
    let defaultOrgId: string;
    const { data: existingOrgs } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('name', 'Default Organization')
      .limit(1)
      .single();

    if (existingOrgs) {
      defaultOrgId = existingOrgs.id;
      console.log('✅ Using existing Default Organization:', defaultOrgId);
    } else {
      // Create Default Organization if it doesn't exist
      const { data: newOrg, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name: 'Default Organization',
          created_by: authData.user.id,
        })
        .select('id')
        .single();

      if (orgError || !newOrg) {
        console.error('⚠️ Error creating Default Organization:', orgError);
        // Try to find any organization as fallback
        const { data: anyOrg } = await supabaseAdmin
          .from('organizations')
          .select('id')
          .limit(1)
          .single();
        
        if (anyOrg) {
          defaultOrgId = anyOrg.id;
          console.log('✅ Using fallback organization:', defaultOrgId);
        } else {
          console.error('❌ No organizations found. Cannot create membership.');
          return NextResponse.json(
            { error: 'Organization setup required' },
            { status: 500 }
          );
        }
      } else {
        defaultOrgId = newOrg.id;
        console.log('✅ Created Default Organization:', defaultOrgId);
      }
    }

    // Map user role to org role
    const orgRoleMap: Record<string, 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner'> = {
      'admin': 'admin',
      'manager': 'manager',
      'cleaner': 'cleaner',
      'homeowner': 'homeowner',
    };
    const orgRole = orgRoleMap[userRole] || 'homeowner';

    // Create organization membership
    console.log('👥 Creating organization membership...');
    const { error: membershipError } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: defaultOrgId,
        user_id: authData.user.id,
        role: orgRole,
      });

    if (membershipError) {
      console.error('⚠️ Organization membership creation error:', membershipError);
      // Don't fail the signup, but log the error
    } else {
      console.log('✅ Organization membership created successfully');
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

