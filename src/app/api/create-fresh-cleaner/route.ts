import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    console.log('Creating fresh cleaner user...');

    // Step 1: Clean up any old cleaner data from database
    console.log('Cleaning up old cleaner data...');
    
    // Delete any profiles with cleaner role or old cleaner emails
    const { error: cleanupError } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .or('role.eq.cleaner,email.like.%cleaner%');

    if (cleanupError) {
      console.log('Cleanup warning (may be expected):', cleanupError.message);
    }

    // Step 1.5: Check if auth user already exists and delete if needed
    console.log('Checking for existing auth user...');
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('Error listing users:', listError);
      return NextResponse.json({
        success: false,
        error: 'Failed to check existing users',
        details: listError.message,
        step: 'user_check'
      });
    }

    const existingCleaner = existingUsers.users.find(u => u.email === 'cleanertest@nexxus.com');
    if (existingCleaner) {
      console.log('Found existing cleaner auth user, deleting...', existingCleaner.id);
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(existingCleaner.id);
      if (deleteError) {
        console.error('Error deleting existing user:', deleteError);
        return NextResponse.json({
          success: false,
          error: 'Failed to delete existing user',
          details: deleteError.message,
          step: 'user_deletion'
        });
      }
      console.log('Existing cleaner auth user deleted successfully');
    }

    // Step 2: Create fresh cleaner auth user
    console.log('Creating fresh cleaner auth user...');
    const { data: cleanerAuth, error: cleanerAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: 'cleanertest@nexxus.com',
      password: 'Clean123!',
      email_confirm: true,
      user_metadata: {
        first_name: 'Test',
        last_name: 'Cleaner',
        role: 'cleaner'
      }
    });

    if (cleanerAuthError) {
      console.error('Error creating cleaner auth user:', cleanerAuthError);
      return NextResponse.json({
        success: false,
        error: 'Failed to create cleaner auth user',
        details: cleanerAuthError.message,
        step: 'auth_creation'
      });
    }

    console.log('Cleaner auth user created:', { id: cleanerAuth.user.id, email: cleanerAuth.user.email });

    // Step 3: Wait a moment for the trigger to create the profile
    console.log('Waiting for database trigger to create user profile...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3.5: Get Default Organization ID
    let defaultOrgId: string;
    const { data: defaultOrg } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('name', 'Default Organization')
      .limit(1)
      .single();

    if (defaultOrg) {
      defaultOrgId = defaultOrg.id;
    } else {
      // Create Default Organization if it doesn't exist
      const { data: newOrg, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({
          name: 'Default Organization',
          created_by: cleanerAuth.user.id,
        })
        .select('id')
        .single();

      if (orgError || !newOrg) {
        console.error('Error creating Default Organization:', orgError);
        // Try to find any organization as fallback
        const { data: anyOrg } = await supabaseAdmin
          .from('organizations')
          .select('id')
          .limit(1)
          .single();
        
        if (!anyOrg) {
          return NextResponse.json({
            success: false,
            error: 'No organization found. Cannot create cleaner profile.',
            step: 'organization_lookup'
          });
        }
        defaultOrgId = anyOrg.id;
      } else {
        defaultOrgId = newOrg.id;
      }
    }

    // Step 4: Create cleaner_profiles entry
    console.log('Creating cleaner_profiles entry...');
    const { data: cleanerProfileEntry, error: cleanerProfileEntryError } = await supabaseAdmin
      .from('cleaner_profiles')
      .insert({
        id: cleanerAuth.user.id, // This should be 'id', not 'user_id' based on schema
        organization_id: defaultOrgId,
        is_available: true,
        hourly_rate: 25.00,
        experience_years: 2,
        rating: 4.8,
        total_jobs: 0,
        background_check_verified: true,
        insurance_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (cleanerProfileEntryError) {
      console.error('Error creating cleaner_profiles entry:', cleanerProfileEntryError);
      // Don't fail the whole process for this
    } else {
      console.log('Cleaner_profiles entry created:', cleanerProfileEntry);
    }

    // Step 5: Final verification
    const { data: finalProfile, error: finalError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', cleanerAuth.user.id)
      .single();

    if (finalError) {
      console.error('Error verifying final profile:', finalError);
      return NextResponse.json({
        success: false,
        error: 'Failed to verify cleaner profile',
        details: finalError.message,
        step: 'verification'
      });
    }

    // Step 6: Get all current users for verification
    const { data: allUsers, error: allUsersError } = await supabaseAdmin.auth.admin.listUsers();
    const { data: allProfiles, error: allProfilesError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .order('email');

    return NextResponse.json({
      success: true,
      message: 'Fresh cleaner user created successfully!',
      cleaner: {
        authId: cleanerAuth.user.id,
        email: cleanerAuth.user.email,
        profile: finalProfile,
        cleanerProfile: cleanerProfileEntry
      },
      credentials: {
        email: 'cleanertest@nexxus.com',
        password: 'Clean123!'
      },
      verification: {
        totalAuthUsers: allUsers?.users.length || 0,
        totalProfiles: allProfiles?.length || 0,
        authUsers: allUsers?.users.map(u => ({ 
          id: u.id.substring(0, 8) + '...', 
          email: u.email 
        })) || [],
        profiles: allProfiles?.map(p => ({ 
          id: p.id.substring(0, 8) + '...', 
          email: p.email, 
          role: p.role 
        })) || []
      }
    });

  } catch (error) {
    console.error('Create fresh cleaner error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error', 
        details: String(error) 
      },
      { status: 500 }
    );
  }
}
