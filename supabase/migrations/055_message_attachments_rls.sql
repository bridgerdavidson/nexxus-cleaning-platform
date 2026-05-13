-- Migration: Formalize message-attachments storage bucket + RLS
--
-- The `message-attachments` bucket pre-dated the migration history (created via
-- the Supabase dashboard). Now that the client uploads directly via supabase-js,
-- we want explicit RLS so the policies are versioned and reproducible.
--
-- Path convention going forward: {conversationId}/{uuid}.jpg
-- This lets the RLS extract the conversation id and verify the caller is one
-- of the two participants on the conversation.

-- ============================================================================
-- PART 1: Ensure bucket exists (idempotent)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  true,
  10485760, -- 10 MB per file
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = EXCLUDED.public;

-- ============================================================================
-- PART 2: Storage RLS policies
-- ============================================================================

-- Drop any prior policies on this bucket so the new ones are authoritative.
DROP POLICY IF EXISTS "Anyone can view message attachments" ON storage.objects;
DROP POLICY IF EXISTS "Participants can upload message attachments" ON storage.objects;
DROP POLICY IF EXISTS "Participants can delete message attachments" ON storage.objects;

-- Public read (bucket is public, but policy makes intent explicit)
CREATE POLICY "Anyone can view message attachments"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'message-attachments');

-- Conversation participants can upload
CREATE POLICY "Participants can upload message attachments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND EXISTS (
      SELECT 1
      FROM conversations c
      WHERE c.id = (split_part(name, '/', 1))::uuid
        AND auth.uid() IN (c.participant_1_id, c.participant_2_id)
    )
  );

-- Conversation participants can delete their own attachments
CREATE POLICY "Participants can delete message attachments"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND EXISTS (
      SELECT 1
      FROM conversations c
      WHERE c.id = (split_part(name, '/', 1))::uuid
        AND auth.uid() IN (c.participant_1_id, c.participant_2_id)
    )
  );

-- ============================================================================
-- PART 3: message_attachments table RLS
-- Caller must own the parent message (sender) to insert; either participant
-- of the conversation may read.
-- ============================================================================
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sender can insert message attachments" ON message_attachments;
DROP POLICY IF EXISTS "Participants can view message attachments" ON message_attachments;
DROP POLICY IF EXISTS "Sender can delete message attachments" ON message_attachments;

CREATE POLICY "Sender can insert message attachments"
  ON message_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_attachments.message_id
        AND m.sender_id = auth.uid()
    )
  );

CREATE POLICY "Participants can view message attachments"
  ON message_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_attachments.message_id
        AND auth.uid() IN (m.sender_id, m.recipient_id)
    )
  );

CREATE POLICY "Sender can delete message attachments"
  ON message_attachments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_attachments.message_id
        AND m.sender_id = auth.uid()
    )
  );
