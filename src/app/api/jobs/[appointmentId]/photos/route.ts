import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Server-side constants (mirrors src/lib/upload.ts — defense in depth)
const JOB_PHOTOS_BUCKET = 'job-photos';
const JOB_PHOTOS_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const JOB_PHOTOS_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const JOB_PHOTOS_MAX_BATCH_SIZE = 10;
const VALID_PHOTO_TYPES = ['before', 'after', 'during'] as const;

type PhotoType = (typeof VALID_PHOTO_TYPES)[number];

interface UploadedPhoto {
  id: string;
  url: string;
  photo_type: PhotoType;
}

interface UploadError {
  fileIndex: number;
  fileName: string;
  message: string;
}

/**
 * Extracts the storage object path from a full Supabase public URL.
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/job-photos/appointments/abc/before/uuid.jpg"
 * → "appointments/abc/before/uuid.jpg"
 */
function pathFromPublicUrl(url: string): string | null {
  try {
    const marker = `/object/public/${JOB_PHOTOS_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.slice(idx + marker.length);
  } catch {
    return null;
  }
}

// POST /api/jobs/[appointmentId]/photos
// Accepts: FormData with photoType ('before'|'after'|'during') and one or more 'files' entries
// Returns: { uploaded: UploadedPhoto[], errors: UploadError[] }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> }
) {
  try {
    // ─── Authentication ───────────────────────────────────────────────────────
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // ─── Route params ─────────────────────────────────────────────────────────
    const { appointmentId } = await params;

    if (!appointmentId) {
      return NextResponse.json({ error: 'Missing appointmentId' }, { status: 400 });
    }

    // ─── Authorization: caller must be the assigned cleaner ───────────────────
    const { data: appointment, error: apptError } = await supabaseAdmin
      .from('appointments')
      .select('id, cleaner_id')
      .eq('id', appointmentId)
      .single();

    if (apptError || !appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (appointment.cleaner_id !== authUser.id) {
      return NextResponse.json(
        { error: 'You are not the assigned cleaner for this appointment' },
        { status: 403 }
      );
    }

    // ─── Parse FormData ───────────────────────────────────────────────────────
    const formData = await request.formData();

    const photoType = formData.get('photoType') as string | null;
    if (!photoType || !VALID_PHOTO_TYPES.includes(photoType as PhotoType)) {
      return NextResponse.json(
        { error: `photoType must be one of: ${VALID_PHOTO_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const rawFiles = formData.getAll('files') as File[];
    if (rawFiles.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    if (rawFiles.length > JOB_PHOTOS_MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Maximum ${JOB_PHOTOS_MAX_BATCH_SIZE} photos per upload. Received ${rawFiles.length}.` },
        { status: 400 }
      );
    }

    // ─── Process files ────────────────────────────────────────────────────────
    const uploaded: UploadedPhoto[] = [];
    const errors: UploadError[] = [];

    for (let i = 0; i < rawFiles.length; i++) {
      const file = rawFiles[i];

      // Per-file server-side validation
      if (!JOB_PHOTOS_ALLOWED_TYPES.includes(file.type)) {
        errors.push({
          fileIndex: i,
          fileName: file.name,
          message: `File type "${file.type}" not allowed. Accepted: JPEG, PNG, WebP.`,
        });
        continue;
      }

      if (file.size > JOB_PHOTOS_MAX_FILE_SIZE) {
        errors.push({
          fileIndex: i,
          fileName: file.name,
          message: `"${file.name}" exceeds 10 MB (received ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        continue;
      }

      // Build deterministic storage path
      const objectPath = `appointments/${appointmentId}/${photoType}/${crypto.randomUUID()}.jpg`;

      // Upload to Supabase Storage
      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabaseAdmin.storage
        .from(JOB_PHOTOS_BUCKET)
        .upload(objectPath, arrayBuffer, {
          contentType: 'image/jpeg',
          cacheControl: '31536000', // 1 year — URLs are immutable (UUID path)
          upsert: false,
        });

      if (uploadError) {
        errors.push({
          fileIndex: i,
          fileName: file.name,
          message: `Upload failed: ${uploadError.message}`,
        });
        continue;
      }

      // Get the stable public URL
      const { data: { publicUrl } } = supabaseAdmin.storage
        .from(JOB_PHOTOS_BUCKET)
        .getPublicUrl(objectPath);

      // Insert record into job_photos
      const { data: photoRecord, error: dbError } = await supabaseAdmin
        .from('job_photos')
        .insert({
          appointment_id: appointmentId,
          photo_url: publicUrl,
          photo_type: photoType,
        })
        .select('id')
        .single();

      if (dbError) {
        // Best-effort cleanup: remove the uploaded file to avoid orphans
        await supabaseAdmin.storage.from(JOB_PHOTOS_BUCKET).remove([objectPath]);
        errors.push({
          fileIndex: i,
          fileName: file.name,
          message: `Database error after upload: ${dbError.message}`,
        });
        continue;
      }

      uploaded.push({
        id: photoRecord.id,
        url: publicUrl,
        photo_type: photoType as PhotoType,
      });
    }

    // If every file failed validation before any upload attempt, return 400
    if (uploaded.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: errors[0].message, errors },
        { status: 400 }
      );
    }

    return NextResponse.json({ uploaded, errors }, { status: 200 });
  } catch (err) {
    console.error('Job photo upload unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/jobs/[appointmentId]/photos
// Body: { photoId: string }
// Deletes a single photo record and its storage object (cleaner must own the appointment)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> }
) {
  try {
    // ─── Authentication ───────────────────────────────────────────────────────
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // ─── Route params ─────────────────────────────────────────────────────────
    const { appointmentId } = await params;

    // ─── Authorization ────────────────────────────────────────────────────────
    const { data: appointment, error: apptError } = await supabaseAdmin
      .from('appointments')
      .select('id, cleaner_id')
      .eq('id', appointmentId)
      .single();

    if (apptError || !appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (appointment.cleaner_id !== authUser.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ─── Body ─────────────────────────────────────────────────────────────────
    const body = await request.json();
    const { photoId } = body as { photoId?: string };

    if (!photoId) {
      return NextResponse.json({ error: 'Missing photoId' }, { status: 400 });
    }

    // Fetch the photo record (verify it belongs to this appointment)
    const { data: photo, error: photoError } = await supabaseAdmin
      .from('job_photos')
      .select('id, photo_url')
      .eq('id', photoId)
      .eq('appointment_id', appointmentId)
      .single();

    if (photoError || !photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    // Remove storage object (best-effort)
    const storagePath = pathFromPublicUrl(photo.photo_url);
    if (storagePath) {
      await supabaseAdmin.storage.from(JOB_PHOTOS_BUCKET).remove([storagePath]);
    }

    // Delete DB record
    const { error: deleteError } = await supabaseAdmin
      .from('job_photos')
      .delete()
      .eq('id', photoId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('Job photo delete unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
