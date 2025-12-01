import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    console.log('Removing trigger and creating users manually...');

    // Step 1: Clean up any existing users first
    console.log('Cleaning up existing users...');
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (!listError && existingUsers) {
      for (const user of existingUsers.users) {
        if (user.email && (
          user.email.includes('admin@nexxus.com') || 
          user.email.includes('cleaner@nexxus.com') ||
          user.email.includes('test@nexxus.com')
        )) {
          console.log('Deleting existing user:', user.email);
          await supabaseAdmin.auth.admin.deleteUser(user.id);
        }
      }
    }

    // Clean up profiles
    await supabaseAdmin
      .from('user_profiles')
      .delete()
      .or('email.like.%@nexxus.com,email.like.%test%');

    // Step 2: Create admin user (without relying on trigger)
    console.log('Creating admin user...');
    const { data: adminAuth, error: adminAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: 'admin@nexxus.com',
      password: 'Admin123!',
      email_confirm: true
      // No user_metadata to avoid trigger issues
    });

    if (adminAuthError) {
      console.error('Admin auth creation error:', adminAuthError);
      return NextResponse.json({
        success: false,
        error: 'Failed to create admin auth user',
        details: adminAuthError.message,
        step: 'admin_auth_creation'
      });
    }

    console.log('Admin auth user created successfully:', adminAuth.user.id);

    // Step 3: Manually create admin profile (this should work with service role)
    console.log('Creating admin profile manually...');
    const { data: adminProfile, error: adminProfileError } = await supabaseAdmin
      .from('user_profiles')
      .insert({
        id: adminAuth.user.id,
        email: 'admin@nexxus.com',
        first_name: 'Admin',
        last_name: 'User',
        role: 'admin'
      })
      .select()
      .single();

    if (adminProfileError) {
      console.error('Admin profile creation error:', adminProfileError);
      // Clean up auth user
      await supabaseAdmin.auth.admin.deleteUser(adminAuth.user.id);
      return NextResponse.json({
        success: false,
        error: 'Failed to create admin profile',
        details: adminProfileError.message,
        step: 'admin_profile_creation'
      });
    }

    console.log('Admin profile created successfully:', adminProfile);

    // Step 4: Create cleaner user
    console.log('Creating cleaner user...');
    const { data: cleanerAuth, error: cleanerAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: 'cleaner@nexxus.com',
      password: 'Clean123!',
      email_confirm: true
    });

    if (cleanerAuthError) {
      console.error('Cleaner auth creation error:', cleanerAuthError);
      return NextResponse.json({
        success: false,
        error: 'Failed to create cleaner auth user',
        details: cleanerAuthError.message,
        step: 'cleaner_auth_creation'
      });
    }

    console.log('Cleaner auth user created successfully:', cleanerAuth.user.id);

    // Step 5: Create cleaner profile
    console.log('Creating cleaner profile...');
    const { data: cleanerProfile, error: cleanerProfileError } = await supabaseAdmin
      .from('user_profiles')
      .insert({
        id: cleanerAuth.user.id,
        email: 'cleaner@nexxus.com',
        first_name: 'Test',
        last_name: 'Cleaner',
        role: 'cleaner'
      })
      .select()
      .single();

    if (cleanerProfileError) {
      console.error('Cleaner profile creation error:', cleanerProfileError);
      await supabaseAdmin.auth.admin.deleteUser(cleanerAuth.user.id);
      return NextResponse.json({
        success: false,
        error: 'Failed to create cleaner profile',
        details: cleanerProfileError.message,
        step: 'cleaner_profile_creation'
      });
    }

    console.log('Cleaner profile created successfully:', cleanerProfile);

    // Step 5.5: Get Default Organization ID
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

    // Step 6: Create cleaner_profiles entry
    console.log('Creating cleaner_profiles entry...');
    const { data: cleanerProfileEntry, error: cleanerProfileEntryError } = await supabaseAdmin
      .from('cleaner_profiles')
      .insert({
        id: cleanerAuth.user.id,
        organization_id: defaultOrgId,
        bio: 'Experienced professional cleaner',
        experience_years: 3,
        hourly_rate: 25.00,
        rating: 4.8,
        total_jobs: 0,
        is_available: true,
        background_check_verified: true,
        insurance_verified: true
      })
      .select()
      .single();

    if (cleanerProfileEntryError) {
      console.error('Cleaner profile entry error:', cleanerProfileEntryError);
      // Don't fail the whole process for this
    }

    // Step 7: Final verification
    const { data: allUsers } = await supabaseAdmin.auth.admin.listUsers();
    const { data: allProfiles } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .order('email');

    return NextResponse.json({
      success: true,
      message: 'Users created successfully without trigger dependency!',
      users: {
        admin: {
          authId: adminAuth.user.id,
          email: adminAuth.user.email,
          profile: adminProfile
        },
        cleaner: {
          authId: cleanerAuth.user.id,
          email: cleanerAuth.user.email,
          profile: cleanerProfile,
          cleanerProfile: cleanerProfileEntry
        }
      },
      credentials: {
        admin: { email: 'admin@nexxus.com', password: 'Admin123!' },
        cleaner: { email: 'cleaner@nexxus.com', password: 'Clean123!' }
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
    console.error('Remove trigger and create users error:', error);
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
