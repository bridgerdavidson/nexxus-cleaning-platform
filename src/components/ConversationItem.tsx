import React from "react";
import { ConversationWithDetails } from "../types";

interface ConversationItemProps {
  conversation: ConversationWithDetails;
  isSelected: boolean;
  currentUserId: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export default function ConversationItem({
  conversation,
  isSelected,
  currentUserId,
  onClick,
  onContextMenu,
}: ConversationItemProps) {
  const { other_participant, last_message, unread_count } = conversation;

  // Guard against missing participant
  if (!other_participant) {
    return null;
  }

  const getInitials = () => {
    const firstName = other_participant.first_name || "";
    const lastName = other_participant.last_name || "";
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "?";
  };

  const getLastMessagePreview = () => {
    if (!last_message) return "No messages yet";

    const isSentByMe = last_message.sender_id === currentUserId;
    const preview =
      last_message.content.length > 50
        ? `${last_message.content.substring(0, 50)}...`
        : last_message.content;

    return isSentByMe ? `You: ${preview}` : preview;
  };

  const getRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "Just now";
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400)
      return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800)
      return `${Math.floor(diffInSeconds / 86400)}d ago`;

    // If older than a week, show date
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
    };
    if (date.getFullYear() !== now.getFullYear()) {
      options.year = "numeric";
    }
    return date.toLocaleDateString("en-US", options);
  };

  const formatTime = () => {
    if (last_message) {
      return getRelativeTime(last_message.created_at);
    }
    return getRelativeTime(conversation.created_at);
  };

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex items-start space-x-3 p-4 cursor-pointer transition-colors ${
        isSelected ? "bg-gray-100" : "hover:bg-gray-50"
      }`}
    >
      {/* Avatar */}
      <div className="flex-shrink-0">
        {other_participant.avatar_url ? (
          <img
            src={other_participant.avatar_url}
            alt={`${other_participant.first_name} ${other_participant.last_name}`}
            className="w-12 h-12 rounded-full object-cover"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold">
            {getInitials()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1">
          <h3
            className={`text-sm truncate ${
              unread_count > 0
                ? "font-bold text-gray-900"
                : "font-medium text-gray-900"
            }`}
          >
            {other_participant.first_name} {other_participant.last_name}
          </h3>
          <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
            {formatTime()}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <p
            className={`text-sm truncate ${
              unread_count > 0 ? "font-semibold text-gray-900" : "text-gray-600"
            }`}
          >
            {getLastMessagePreview()}
          </p>
          {unread_count > 0 && (
            <span className="ml-2 flex-shrink-0 bg-primary-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unread_count > 9 ? "9+" : unread_count}
            </span>
          )}
        </div>

        {/* Role badge */}
        <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
          {other_participant.role}
        </span>
      </div>
    </div>
  );
}
