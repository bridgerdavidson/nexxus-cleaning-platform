-- Migration: Enable Supabase Realtime for messaging tables
-- This enables real-time subscriptions for messages and conversations tables
-- so that new messages appear instantly without page refresh

-- Enable realtime for messages table
-- This allows clients to subscribe to INSERT, UPDATE, DELETE events
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable realtime for conversations table
-- This allows clients to subscribe to conversation updates (e.g., last_message_at changes)
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- Enable realtime for message_attachments table
-- This allows clients to receive attachment updates when they're added to messages
ALTER PUBLICATION supabase_realtime ADD TABLE message_attachments;

-- Note: Ensure RLS policies allow SELECT for the subscribing user
-- The existing policies should work:
-- - "Users can view their messages" policy allows SELECT for sender/recipient
-- - Realtime will respect these RLS policies

-- Add index for conversation_id filtering if not exists (improves realtime filter performance)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Add composite index for faster message queries within a conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);

