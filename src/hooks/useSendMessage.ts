import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { uploadImages } from '../lib/upload';
import { useAuth } from './useAuth';

interface SendMessageOptions {
  conversationId?: string;
  senderId: string;
  recipientId: string;
  content: string;
  attachments?: File[];
}

export function useSendMessage() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganizationId } = useAuth();

  const sendMessage = async ({
    conversationId,
    senderId,
    recipientId,
    content,
    attachments = []
  }: SendMessageOptions) => {
    try {
      setSending(true);
      setError(null);

      // Ensure we have an organization ID
      if (!currentOrganizationId) {
        const errorMsg = 'No organization selected. Please select an organization to send messages.';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }

      // Get or create conversation
      let finalConversationId = conversationId;
      if (!finalConversationId) {
        console.log('Creating/getting conversation for:', { senderId, recipientId });
        const { data: convData, error: convError } = await supabase
          .rpc('get_or_create_conversation', {
            user1_id: senderId,
            user2_id: recipientId
          });

        if (convError) {
          console.error('Error getting/creating conversation:', convError);
          console.error('Error details:', JSON.stringify(convError, null, 2));
          throw convError;
        }
        console.log('Conversation ID:', convData);
        finalConversationId = convData;
      }

      // Create message
      console.log('Inserting message:', {
        conversation_id: finalConversationId,
        sender_id: senderId,
        recipient_id: recipientId,
        content: content.substring(0, 50) + '...'
      });

      const { data: messageData, error: messageError } = await supabase
        .from('messages')
        .insert({
          organization_id: currentOrganizationId,
          conversation_id: finalConversationId,
          sender_id: senderId,
          recipient_id: recipientId,
          content,
          is_read: false
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error inserting message:', messageError);
        console.error('Error details:', JSON.stringify(messageError, null, 2));
        throw messageError;
      }

      console.log('Message created successfully:', messageData);

      // Upload attachments if any
      if (attachments.length > 0) {
        const uploadResults = await uploadImages(attachments);
        
        const successfulUploads = uploadResults.filter(result => result.success);
        
        if (successfulUploads.length > 0) {
          const attachmentRecords = successfulUploads.map(result => ({
            message_id: messageData.id,
            file_url: result.url!,
            file_type: attachments[uploadResults.indexOf(result)].type,
            file_size: attachments[uploadResults.indexOf(result)].size
          }));

          const { error: attachmentError } = await supabase
            .from('message_attachments')
            .insert(attachmentRecords);

          if (attachmentError) {
            console.error('Error saving attachments:', attachmentError);
            // Don't fail the entire operation if attachments fail
          }
        }
      }

      return { success: true, messageId: messageData.id, conversationId: finalConversationId };
    } catch (err) {
      console.error('Error sending message:', err);
      console.error('Full error object:', JSON.stringify(err, null, 2));
      
      let errorMessage = 'Failed to send message';
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null) {
        // Handle Supabase error objects
        const supabaseError = err as { message?: string; code?: string; details?: string; hint?: string };
        errorMessage = supabaseError.message || supabaseError.details || errorMessage;
        console.error('Supabase error code:', supabaseError.code);
        console.error('Supabase error hint:', supabaseError.hint);
      }
      
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setSending(false);
    }
  };

  return {
    sendMessage,
    sending,
    error
  };
}

