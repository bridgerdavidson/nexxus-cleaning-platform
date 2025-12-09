import React from "react";
import { MessageWithDetails } from "../types";
import { Check, CheckCheck } from "lucide-react";

interface MessageBubbleProps {
  message: MessageWithDetails;
  isSent: boolean;
}

export default function MessageBubble({ message, isSent }: MessageBubbleProps) {
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
      <div className={`max-w-[70%] ${isSent ? "order-2" : "order-1"}`}>
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div
            className={`grid gap-2 mb-2 ${
              message.attachments.length === 1
                ? "grid-cols-1"
                : message.attachments.length === 2
                ? "grid-cols-2"
                : "grid-cols-2"
            }`}
          >
            {message.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="relative rounded-lg overflow-hidden"
              >
                <img
                  src={attachment.file_url}
                  alt="Attachment"
                  className="w-full h-auto object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => window.open(attachment.file_url, "_blank")}
                />
              </div>
            ))}
          </div>
        )}

        {/* Message bubble */}
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
    </div>
  );
}
