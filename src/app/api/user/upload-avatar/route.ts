import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const AVATAR_BUCKET = 'avatars';
const AVATAR_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Extracts the storage object path from a full Supabase public URL.
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/avatars/users/abc/avatar/file.jpg"
 * → "users/abc/avatar/file.jpg"
 */
function pathFromPublicUrl(url: string): string | null {
  try {
    const marker = `/object/public/${AVATAR_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify the caller is authenticated
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const userId = authUser.id;

    // Parse the multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Server-side validation (defense in depth — client also validates)
    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File type not allowed. Accepted: ${AVATAR_ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (file.size > AVATAR_MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds 5 MB limit (received ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
        { status: 400 }
      );
    }

    // Build the storage path scoped to this user
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const objectPath = `users/${userId}/avatar/${crypto.randomUUID()}.${ext}`;

    // Delete the previous avatar if one exists — fetch current avatar_url from DB
    const { data: profileData } = await supabaseAdmin
      .from('user_profiles')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    if (profileData?.avatar_url) {
      const oldPath = pathFromPublicUrl(profileData.avatar_url);
      if (oldPath) {
        // Ignore delete errors — old file removal is best-effort
        await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([oldPath]);
      }
    }

    // Upload the new file
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .upload(objectPath, arrayBuffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Avatar upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get the stable public URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(objectPath);

    // Persist the public URL to the user's profile row (only their own row)
    const { error: dbError } = await supabaseAdmin
      .from('user_profiles')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (dbError) {
      console.error('Avatar DB update error:', dbError);
      // Clean up the uploaded file since DB write failed
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([objectPath]);
      return NextResponse.json({ error: 'Failed to save avatar reference' }, { status: 500 });
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error('Upload avatar unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
