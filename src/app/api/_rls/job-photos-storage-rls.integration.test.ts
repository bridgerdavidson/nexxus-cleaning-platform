import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, createTestAppointment, type TestOrgFixture } from '../../../../tests/helpers/fixtures';

/**
 * job-photos STORAGE RLS (migration job_photos_storage_rls_helper).
 *
 * Regression cover for the 2026-08-27 production incident: every cleaner photo
 * upload failed with `new row violates row-level security policy for table
 * "objects"`, and no test caught it for 26 days.
 *
 * Why it went unnoticed: the price-seal suite already asserts that a cleaner can
 * insert/select/delete job photos, but it exercises the `job_photos` TABLE,
 * whose policy the seal migration DID convert to the SECURITY DEFINER helper.
 * The failing object was `storage.objects`, whose policy it did not. The table
 * passed while the bucket was broken.
 *
 * So these tests deliberately go through `.storage`, not `.from('job_photos')`.
 * They also depend on the bucket existing locally, which is only true because
 * the migration now re-declares it (it used to exist solely as dashboard state
 * in dev/prod, invisible to `supabase db reset`).
 *
 * Path convention under test: appointments/{appointmentId}/{phase}/{uuid}.jpg
 */

const BUCKET = 'job-photos';

// A one-pixel JPEG. Content is irrelevant to RLS; we only need real bytes.
const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

function objectPath(appointmentId: string, phase: 'before' | 'after' = 'before'): string {
  return `appointments/${appointmentId}/${phase}/${crypto.randomUUID()}.jpg`;
}

describe('job-photos storage RLS', () => {
  let org: TestOrgFixture;
  let otherOrg: TestOrgFixture;
  let apptId: string;
  const admin = createTestSupabaseClient();
  const uploaded: string[] = [];

  beforeAll(async () => {
    org = await withTestOrg();
    otherOrg = await withTestOrg();
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'in_progress',
    });
    apptId = appt.id;
  });

  afterAll(async () => {
    if (uploaded.length > 0) {
      await admin.storage.from(BUCKET).remove(uploaded);
    }
    await org.cleanup();
    await otherOrg.cleanup();
  });

  it('the bucket exists (it must ship in a migration, not dashboard state)', async () => {
    const { data, error } = await admin.storage.getBucket(BUCKET);
    expect(error).toBeNull();
    expect(data?.name).toBe(BUCKET);
  });

  it('the assigned cleaner can upload a before photo', async () => {
    const cleaner = createUserClient(org.cleaner.accessToken);
    const path = objectPath(apptId, 'before');

    const { error } = await cleaner.storage
      .from(BUCKET)
      .upload(path, PIXEL, { contentType: 'image/jpeg', upsert: false });

    // This is the exact assertion that was false in production on 2026-08-27.
    expect(error).toBeNull();
    uploaded.push(path);
  });

  it('the assigned cleaner can upload an after photo too', async () => {
    const cleaner = createUserClient(org.cleaner.accessToken);
    const path = objectPath(apptId, 'after');

    const { error } = await cleaner.storage
      .from(BUCKET)
      .upload(path, PIXEL, { contentType: 'image/jpeg', upsert: false });

    expect(error).toBeNull();
    uploaded.push(path);
  });

  it('the assigned cleaner can delete their own job photo', async () => {
    const cleaner = createUserClient(org.cleaner.accessToken);
    const path = objectPath(apptId, 'before');

    const { error: uploadError } = await cleaner.storage
      .from(BUCKET)
      .upload(path, PIXEL, { contentType: 'image/jpeg', upsert: false });
    expect(uploadError).toBeNull();

    const { data, error } = await cleaner.storage.from(BUCKET).remove([path]);
    expect(error).toBeNull();
    // storage-js reports an RLS-denied remove as an empty result, not an error.
    expect(data).toHaveLength(1);
  });

  it('a cleaner from another org cannot upload to this appointment', async () => {
    const stranger = createUserClient(otherOrg.cleaner.accessToken);
    const path = objectPath(apptId, 'before');

    const { error } = await stranger.storage
      .from(BUCKET)
      .upload(path, PIXEL, { contentType: 'image/jpeg', upsert: false });

    expect(error).not.toBeNull();
  });

  it('an unassigned appointment is not writable by the org cleaner', async () => {
    const unassigned = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: null,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
    });
    const cleaner = createUserClient(org.cleaner.accessToken);

    const { error } = await cleaner.storage
      .from(BUCKET)
      .upload(objectPath(unassigned.id), PIXEL, { contentType: 'image/jpeg', upsert: false });

    expect(error).not.toBeNull();
  });

  it('uploaded photos are publicly readable (the bucket is public by design)', async () => {
    const cleaner = createUserClient(org.cleaner.accessToken);
    const path = objectPath(apptId, 'before');
    const { error: uploadError } = await cleaner.storage
      .from(BUCKET)
      .upload(path, PIXEL, { contentType: 'image/jpeg', upsert: false });
    expect(uploadError).toBeNull();
    uploaded.push(path);

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
    const res = await fetch(data.publicUrl);
    expect(res.ok).toBe(true);
  });
});
