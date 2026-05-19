import React, { useState } from "react";
import { MessageWithDetails } from "../types";
import { Check, CheckCheck } from "lucide-react";
import MessageAttachmentsLightbox from "./MessageAttachmentsLightbox";

interface MessageBubbleProps {
  message: MessageWithDetails;
  isSent: boolean;
  // Fired once each attachment image finishes loading. Used by MessageThread
  // to re-pin the scroll to the bottom after layout grows.
  onImageLoad?: () => void;
}

export default function MessageBubble({ message, isSent, onImageLoad }: MessageBubbleProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const attachments = message.attachments ?? [];

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Handle case where sender/recipient might be null
  if (!message.sender || !message.recipient) {
    console.warn("Message missing sender or recipient:", message);
  }

  return (
    <div className={`flex ${isSent ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[70%] flex flex-col ${
          isSent ? "items-end order-2" : "items-start order-1"
        }`}
      >
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div
            className={`grid gap-2 ${
              message.content.trim() ? "mb-2" : ""
            } ${
              message.attachments.length === 1
                ? "grid-cols-1"
                : "grid-cols-2"
            }`}
          >
            {message.attachments.map((attachment, idx) => (
              <div
                key={attachment.id}
                className="relative rounded-lg overflow-hidden"
              >
                <img
                  src={attachment.file_url}
                  alt="Attachment"
                  className="w-full h-auto object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setLightboxIndex(idx)}
                  onLoad={onImageLoad}
                />
              </div>
            ))}
          </div>
        )}

        {/* Message bubble — only render when there's actual text. Attachments
            can stand alone (image-only sends). */}
        {message.content.trim() && (
          <div
            className={`inline-block px-4 py-2 ${
              isSent
                ? "bg-primary-600 text-white rounded-2xl"
                : "bg-gray-200 text-gray-900 rounded-2xl"
            }`}
            style={{
              ...(isSent
                ? { borderRadius: "18px 18px 4px 18px" }
                : { borderRadius: "18px 18px 18px 4px" }),
            }}
          >
            <p className="text-sm whitespace-pre-wrap break-words">
              {message.content.trim()}
            </p>
          </div>
        )}

        {/* Timestamp and read status */}
        <div
          className={`flex items-center space-x-1 mt-1 px-2 ${
            isSent ? "justify-end" : "justify-start"
          }`}
        >
          <span className="text-xs text-gray-500">
            {formatTime(message.created_at)}
          </span>
          {isSent && (
            <span className="text-gray-500">
              {message.is_read ? (
                <CheckCheck className="w-3 h-3" />
              ) : (
                <Check className="w-3 h-3" />
              )}
            </span>
          )}
        </div>
      </div>

      {/* Lightbox is scoped to THIS message's attachments only. */}
      {attachments.length > 0 && (
        <MessageAttachmentsLightbox
          attachments={attachments}
          open={lightboxIndex !== null}
          index={lightboxIndex ?? 0}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
