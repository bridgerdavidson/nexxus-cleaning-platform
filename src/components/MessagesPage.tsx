import React, { useState, useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { UserRole, ConversationWithDetails } from "../types";
import { useDeleteConversation } from "../hooks/useDeleteConversation";
import ConversationList from "./ConversationList";
import MessageThread from "./MessageThread";

interface MessagesPageProps {
  userId: string;
  userRole: UserRole;
  conversations: ConversationWithDetails[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onUpdateUnreadCount: (conversationId: string, newCount: number) => void;
}

export default function MessagesPage({
  userId,
  userRole,
  conversations: allConversations,
  loading,
  error,
  onRefresh,
  onUpdateUnreadCount,
}: MessagesPageProps) {
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationWithDetails | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [isSlidingIn, setIsSlidingIn] = useState(false);
  const [isSlidingOut, setIsSlidingOut] = useState(false);

  // Apply client-side filtering (same logic as useConversations)
  const conversations = useMemo(() => {
    return allConversations.filter((conv) => {
      // Skip if participant is missing
      if (!conv.other_participant) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const name = `${conv.other_participant.first_name || ""} ${
          conv.other_participant.last_name || ""
        }`.toLowerCase();
        const email = conv.other_participant.email?.toLowerCase() || "";

        if (!name.includes(searchLower) && !email.includes(searchLower)) {
          return false;
        }
      }

      // Role filter
      if (roleFilter && roleFilter !== "all") {
        if (conv.other_participant.role !== roleFilter) {
          return false;
        }
      }

      return true;
    });
  }, [allConversations, searchQuery, roleFilter]);

  const { deleteConversation, deleting } = useDeleteConversation();

  // Determine which roles to show in filter based on user's role
  const getAvailableRoles = (): UserRole[] => {
    switch (userRole) {
      case "admin":
      case "manager":
        return ["homeowner", "cleaner", "admin", "manager"];
      case "homeowner":
        return ["cleaner", "admin", "manager"];
      case "cleaner":
        return ["homeowner", "admin", "manager"];
      default:
        return [];
    }
  };

  const handleSelectConversation = (conversation: ConversationWithDetails) => {
    // Start off-screen, then trigger slide-in animation
    setIsSlidingIn(false);
    setIsSlidingOut(false);
    setSelectedConversation(conversation);
    // Trigger animation on next frame
    requestAnimationFrame(() => {
      setIsSlidingIn(true);
    });
  };

  const handleBackToConversations = () => {
    setIsSlidingOut(true);
    setIsSlidingIn(false);
    // Wait for animation to complete before removing the conversation
    setTimeout(() => {
      setSelectedConversation(null);
      setIsSlidingOut(false);
    }, 300);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (deleting) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this conversation? All messages will be permanently deleted."
    );

    if (!confirmed) return;

    const result = await deleteConversation(conversationId);

    if (result.success) {
      // If the deleted conversation was selected, clear selection
      if (selectedConversation?.id === conversationId) {
        setSelectedConversation(null);
      }
      // Refresh conversations list
      onRefresh();
    } else {
      alert(`Failed to delete conversation: ${result.error}`);
    }
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] overflow-hidden relative">
      {/* Conversation list - left panel */}
      <div
        className={`w-full md:w-96 lg:w-[400px] flex-shrink-0 transition-transform duration-300 ease-in-out ${
          selectedConversation && !isSlidingOut
            ? "md:translate-x-0 -translate-x-full"
            : "translate-x-0"
        }`}
      >
        <ConversationList
          conversations={conversations}
          loading={loading}
          error={error}
          currentUserId={userId}
          selectedConversationId={selectedConversation?.id || null}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          roleFilter={roleFilter}
          onRoleFilterChange={setRoleFilter}
          availableRoles={getAvailableRoles()}
        />
      </div>

      {/* Message thread - right panel (desktop) */}
      <div className="hidden md:flex md:flex-1">
        <MessageThread
          conversation={selectedConversation}
          currentUserId={userId}
          onUnreadCountUpdate={onUpdateUnreadCount}
        />
      </div>

      {/* Mobile: show thread when conversation selected with slide animation */}
      {selectedConversation && (
        <div
          className={`fixed inset-0 z-50 md:hidden bg-white transition-transform duration-300 ease-in-out ${
            isSlidingOut
              ? "translate-x-full"
              : isSlidingIn
              ? "translate-x-0"
              : "translate-x-full"
          }`}
        >
          <button
            onClick={handleBackToConversations}
            className="absolute top-4 left-4 z-10 p-2 bg-white rounded-full hover:bg-gray-50 transition-colors"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="w-5 h-5 text-gray-900" />
          </button>
          <MessageThread
            conversation={selectedConversation}
            currentUserId={userId}
            onUnreadCountUpdate={updateUnreadCount}
          />
        </div>
      )}
    </div>
  );
}
