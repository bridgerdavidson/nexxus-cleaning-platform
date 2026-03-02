import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const PROPERTY_PHOTOS_BUCKET = 'property-photos';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

function pathFromPublicUrl(url: string): string | null {
  try {
    const marker = `/object/public/${PROPERTY_PHOTOS_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  } catch {
    return null;
  }
}

/** Check if the authenticated user can edit this property (owner or org admin/manager). */
async function canEditProperty(propertyId: string, userId: string): Promise<boolean> {
  const { data: property, error: propError } = await supabaseAdmin
    .from('properties')
    .select('owner_id')
    .eq('id', propertyId)
    .single();

  if (propError || !property) return false;
  if (property.owner_id === userId) return true;

  // Check if user is in same org as owner (admin/manager)
  const { data: orgMembers } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', property.owner_id)
    .limit(1);

  if (!orgMembers?.length) return false;

  const orgId = orgMembers[0].organization_id;
  const { data: actorMember } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  return !!actorMember;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { propertyId } = await params;
    if (!propertyId) {
      return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 });
    }

    const allowed = await canEditProperty(propertyId, authUser.id);
    if (!allowed) {
      return NextResponse.json({ error: 'You do not have permission to edit this property' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File type not allowed. Accepted: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds 10 MB limit (received ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
        { status: 400 }
      );
    }

    const objectPath = `properties/${propertyId}/${crypto.randomUUID()}.jpg`;

    // Delete previous photo if exists
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('photo_url')
      .eq('id', propertyId)
      .single();

    if (prop?.photo_url) {
      const oldPath = pathFromPublicUrl(prop.photo_url);
      if (oldPath) {
        await supabaseAdmin.storage.from(PROPERTY_PHOTOS_BUCKET).remove([oldPath]);
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(PROPERTY_PHOTOS_BUCKET)
      .upload(objectPath, arrayBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadError) {
      console.error('Property photo upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(PROPERTY_PHOTOS_BUCKET)
      .getPublicUrl(objectPath);

    const { error: dbError } = await supabaseAdmin
      .from('properties')
      .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', propertyId);

    if (dbError) {
      console.error('Property photo DB update error:', dbError);
      await supabaseAdmin.storage.from(PROPERTY_PHOTOS_BUCKET).remove([objectPath]);
      return NextResponse.json({ error: 'Failed to save photo reference' }, { status: 500 });
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error('Property photo upload unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { propertyId } = await params;
    if (!propertyId) {
      return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 });
    }

    const allowed = await canEditProperty(propertyId, authUser.id);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: prop, error: fetchError } = await supabaseAdmin
      .from('properties')
      .select('photo_url')
      .eq('id', propertyId)
      .single();

    if (fetchError || !prop) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    if (prop.photo_url) {
      const storagePath = pathFromPublicUrl(prop.photo_url);
      if (storagePath) {
        await supabaseAdmin.storage.from(PROPERTY_PHOTOS_BUCKET).remove([storagePath]);
      }
    }

    const { error: dbError } = await supabaseAdmin
      .from('properties')
      .update({ photo_url: null, updated_at: new Date().toISOString() })
      .eq('id', propertyId);

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Property photo delete unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
