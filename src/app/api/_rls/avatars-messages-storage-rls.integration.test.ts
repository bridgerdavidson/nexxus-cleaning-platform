import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';

/**
 * avatars + message-attachments STORAGE RLS
 * (migration storage_buckets_versioned).
 *
 * Companion to job-photos-storage-rls. Both of these buckets existed only as
 * dashboard state until that migration, so `supabase db reset` never created
 * them and nothing here was reachable. These are the first tests to touch them.
 *
 * message-attachments is the one that mattered: its policies used the same raw
 * `EXISTS (SELECT ... FROM conversations)` shape that broke job-photos uploads
 * in #267, and cleaners are conversation participants. It now goes through
 * public.is_conversation_participant().
 *
 * avatars is path-based (auth.uid() vs the object path) and reads no other
 * table, so it is immune to that class. Covered here for the bucket-exists
 * guarantee and to pin the ownership rule.
 */

const AVATARS = 'avatars';
const ATTACHMENTS = 'message-attachments';

const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const jpeg = { contentType: 'image/jpeg', upsert: false } as const;

describe('avatars + message-attachments storage RLS', () => {
  let org: TestOrgFixture;
  let conversationId: string;
  const admin = createTestSupabaseClient();
  const cleanupAvatars: string[] = [];
  const cleanupAttachments: string[] = [];

  beforeAll(async () => {
    org = await withTestOrg();
    // Cleaner <-> admin conversation, the shape the cleaner app actually uses.
    const { data, error } = await admin
      .from('conversations')
      .insert({
        participant_1_id: org.cleaner.userId,
        participant_2_id: org.admin.userId,
        organization_id: org.organizationId,
      })
      .select('id')
      .single();
    if (error) throw new Error(`conversation seed failed: ${error.message}`);
    conversationId = (data as { id: string }).id;
  });

  afterAll(async () => {
    if (cleanupAvatars.length > 0) await admin.storage.from(AVATARS).remove(cleanupAvatars);
    if (cleanupAttachments.length > 0) await admin.storage.from(ATTACHMENTS).remove(cleanupAttachments);
    await admin.from('conversations').delete().eq('id', conversationId);
    await org.cleanup();
  });

  describe('buckets ship in a migration', () => {
    it.each([AVATARS, ATTACHMENTS])('%s exists', async (bucket) => {
      const { data, error } = await admin.storage.getBucket(bucket);
      expect(error).toBeNull();
      expect(data?.name).toBe(bucket);
    });
  });

  describe('avatars: path-based ownership', () => {
    it('a user can upload their own avatar', async () => {
      const user = createUserClient(org.cleaner.accessToken);
      const path = `users/${org.cleaner.userId}/avatar/${crypto.randomUUID()}.jpg`;

      const { error } = await user.storage.from(AVATARS).upload(path, PIXEL, jpeg);
      expect(error).toBeNull();
      cleanupAvatars.push(path);
    });

    it('a user cannot upload into someone else\'s avatar folder', async () => {
      const user = createUserClient(org.cleaner.accessToken);
      const path = `users/${org.admin.userId}/avatar/${crypto.randomUUID()}.jpg`;

      const { error } = await user.storage.from(AVATARS).upload(path, PIXEL, jpeg);
      expect(error).not.toBeNull();
    });

    it('a user can delete their own avatar', async () => {
      const user = createUserClient(org.cleaner.accessToken);
      const path = `users/${org.cleaner.userId}/avatar/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await user.storage.from(AVATARS).upload(path, PIXEL, jpeg);
      expect(uploadError).toBeNull();

      const { data, error } = await user.storage.from(AVATARS).remove([path]);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  describe('message-attachments: conversation participants only', () => {
    it('a participant can upload an attachment', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const path = `${conversationId}/${crypto.randomUUID()}.jpg`;

      const { error } = await cleaner.storage.from(ATTACHMENTS).upload(path, PIXEL, jpeg);
      expect(error).toBeNull();
      cleanupAttachments.push(path);
    });

    it('the other participant can upload too', async () => {
      const staff = createUserClient(org.admin.accessToken);
      const path = `${conversationId}/${crypto.randomUUID()}.jpg`;

      const { error } = await staff.storage.from(ATTACHMENTS).upload(path, PIXEL, jpeg);
      expect(error).toBeNull();
      cleanupAttachments.push(path);
    });

    it('a non-participant cannot upload into the conversation', async () => {
      const outsider = createUserClient(org.homeowner.accessToken);
      const path = `${conversationId}/${crypto.randomUUID()}.jpg`;

      const { error } = await outsider.storage.from(ATTACHMENTS).upload(path, PIXEL, jpeg);
      expect(error).not.toBeNull();
    });

    it('a participant can delete an attachment', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const path = `${conversationId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await cleaner.storage.from(ATTACHMENTS).upload(path, PIXEL, jpeg);
      expect(uploadError).toBeNull();

      const { data, error } = await cleaner.storage.from(ATTACHMENTS).remove([path]);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    // The regression this migration exists to prevent. The cleaner reaches the
    // bucket through a SECURITY DEFINER helper, so narrowing `conversations`
    // RLS for cleaners (as the price seal did to `appointments`) cannot
    // silently revoke their ability to attach an image to a message.
    it('the cleaner is authorized via the helper, not a caller-RLS read', async () => {
      const cleaner = createUserClient(org.cleaner.accessToken);
      const { data, error } = await cleaner.rpc('is_conversation_participant', {
        p_conversation_id: conversationId,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('the helper says false for a non-participant', async () => {
      const outsider = createUserClient(org.homeowner.accessToken);
      const { data, error } = await outsider.rpc('is_conversation_participant', {
        p_conversation_id: conversationId,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });
});
