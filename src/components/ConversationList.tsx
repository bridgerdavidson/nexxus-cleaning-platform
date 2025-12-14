import React, { useState } from "react";
import { Search, Loader2, MessageCircle, Trash2, Plus } from "lucide-react";
import { ConversationWithDetails, UserRole } from "../types";
import ConversationItem from "./ConversationItem";
import ContextMenu from "./ContextMenu";

interface ConversationListProps {
  conversations: ConversationWithDetails[];
  loading: boolean;
  error: string | null;
  currentUserId: string;
  selectedConversationId: string | null;
  onSelectConversation: (conversation: ConversationWithDetails) => void;
  onDeleteConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  roleFilter: UserRole | "all";
  onRoleFilterChange: (role: UserRole | "all") => void;
  availableRoles: UserRole[];
}

export default function ConversationList({
  conversations,
  loading,
  error,
  currentUserId,
  selectedConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  searchQuery,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  availableRoles,
}: ConversationListProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    conversationId: string;
  } | null>(null);

  const handleContextMenu = (e: React.MouseEvent, conversationId: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      conversationId,
    });
  };

  const handleDeleteConversation = () => {
    if (contextMenu) {
      onDeleteConversation(contextMenu.conversationId);
      setContextMenu(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-4xl font-bold text-gray-900">
            Messages
          </h2>
          <div className="flex items-center gap-2">
            {/* New Conversation Button */}
            <button
              onClick={onNewConversation}
              className="w-8 h-8 rounded-full bg-primary-600 text-white hover:bg-primary-700 flex items-center justify-center transition-colors"
              aria-label="New conversation"
            >
              <Plus className="w-4 h-4" />
            </button>
            {/* Search Toggle Button */}
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <Search className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Search input */}
        {showSearch && (
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
        )}

        {/* Role filter */}
        <select
          value={roleFilter}
          onChange={(e) =>
            onRoleFilterChange(e.target.value as UserRole | "all")
          }
          className="w-full px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm appearance-none bg-white"
        >
          <option value="all">All conversations</option>
          {availableRoles.map((role) => (
            <option key={role} value={role}>
              {role.charAt(0).toUpperCase() + role.slice(1)}s
            </option>
          ))}
        </select>
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <MessageCircle className="w-16 h-16 text-red-300 mb-4" />
            <h3 className="text-lg font-medium text-red-900 mb-2">
              Error Loading Conversations
            </h3>
            <p className="text-sm text-red-600 text-center">{error}</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <MessageCircle className="w-16 h-16 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No conversations
            </h3>
            <p className="text-sm text-gray-600 text-center">
              {searchQuery || roleFilter !== "all"
                ? "No conversations match your filters"
                : "Start a new conversation to get started"}
            </p>
          </div>
        ) : (
          conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isSelected={selectedConversationId === conversation.id}
              currentUserId={currentUserId}
              onClick={() => onSelectConversation(conversation)}
              onContextMenu={(e) => handleContextMenu(e, conversation.id)}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          options={[
            {
              label: "Delete conversation",
              icon: <Trash2 className="w-4 h-4" />,
              onClick: handleDeleteConversation,
              danger: true,
            },
          ]}
        />
      )}
    </div>
  );
}
