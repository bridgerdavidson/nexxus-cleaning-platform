import React, { useState, useMemo, useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { UserRole, ConversationWithDetails } from "../types";
import { useDeleteConversation } from "../hooks/useDeleteConversation";
import { useStartConversation } from "../hooks/useStartConversation";
import { OrganizationMember } from "../hooks/useOrganizationMembers";
import { rolesUserCanMessage } from "../lib/messagingPermissions";
import ConversationList from "./ConversationList";
import MessageThread from "./MessageThread";
import NewConversationModal from "./NewConversationModal";

interface MessagesPageProps {
  userId: string;
  userRole: UserRole;
  conversations: ConversationWithDetails[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onUpdateUnreadCount: (conversationId: string, newCount: number) => void;
  onSelectedConversationChange?: (conversationId: string | null) => void;
  initialOtherParticipantId?: string;
  onInitialParticipantConsumed?: () => void;
}

export default function MessagesPage({
  userId,
  userRole,
  conversations: allConversations,
  loading,
  error,
  onRefresh,
  onUpdateUnreadCount,
  onSelectedConversationChange,
  initialOtherParticipantId,
  onInitialParticipantConsumed,
}: MessagesPageProps) {
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationWithDetails | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [isSlidingIn, setIsSlidingIn] = useState(false);
  const [isSlidingOut, setIsSlidingOut] = useState(false);
  const [showNewConversationModal, setShowNewConversationModal] =
    useState(false);

  // Apply client-side filtering (same logic as useConversations)
  const conversations = useMemo(() => {
    // Safety check: ensure allConversations is an array
    if (!allConversations || !Array.isArray(allConversations)) {
      return [];
    }
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
  const { startConversation, starting } = useStartConversation();

  // Track whether we've already acted on the current initialOtherParticipantId so we don't repeat on re-renders
  const consumedParticipantIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialOtherParticipantId) return;
    if (loading) return;
    if (consumedParticipantIdRef.current === initialOtherParticipantId) return;
    if (starting) return;

    consumedParticipantIdRef.current = initialOtherParticipantId;

    const existing = allConversations.find(
      (c) => c.other_participant?.id === initialOtherParticipantId
    );

    if (existing) {
      handleSelectConversation(existing);
      onInitialParticipantConsumed?.();
      return;
    }

    // No existing conversation — start one
    startConversation(initialOtherParticipantId).then((result) => {
      onRefresh();
      if (result.success) {
        if (result.conversation) {
          handleSelectConversation(result.conversation);
        } else if (result.conversationId) {
          setTimeout(() => {
            const conv = allConversations.find((c) => c.id === result.conversationId);
            if (conv) handleSelectConversation(conv);
          }, 600);
        }
      }
      onInitialParticipantConsumed?.();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOtherParticipantId, loading, allConversations]);

  // Roles the current user is allowed to message — shared with NewConversationModal
  const getAvailableRoles = (): UserRole[] => rolesUserCanMessage(userRole);

  const handleSelectConversation = (conversation: ConversationWithDetails) => {
    // Start off-screen, then trigger slide-in animation
    setIsSlidingIn(false);
    setIsSlidingOut(false);
    setSelectedConversation(conversation);
    onSelectedConversationChange?.(conversation.id);
    // Optimistically clear unread badge immediately
    onUpdateUnreadCount(conversation.id, 0);
    // Trigger animation on next frame
    requestAnimationFrame(() => {
      setIsSlidingIn(true);
    });
  };

  const handleBackToConversations = () => {
    setIsSlidingOut(true);
    setIsSlidingIn(false);
    onSelectedConversationChange?.(null);
    // Wait for animation to complete before removing the conversation
    setTimeout(() => {
      setSelectedConversation(null);
      setIsSlidingOut(false);
    }, 300);
  };

  // Clear the parent's selected-id when MessagesPage unmounts (e.g. tab switch
  // away from Messages) so the nav-bar unread dot can light up again for the
  // previously-open conversation.
  useEffect(() => {
    return () => {
      onSelectedConversationChange?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        onSelectedConversationChange?.(null);
      }
      // Refresh conversations list
      onRefresh();
    } else {
      alert(`Failed to delete conversation: ${result.error}`);
    }
  };

  const handleNewConversation = () => {
    setShowNewConversationModal(true);
  };

  const handleSelectNewConversationUser = async (user: OrganizationMember) => {
    if (starting) return;

    // Close the modal
    setShowNewConversationModal(false);

    // Start/get conversation with selected user
    const result = await startConversation(user.id);

    if (result.success) {
      // Refresh conversations list to include the new conversation
      onRefresh();

      // If we got the full conversation object, select it
      if (result.conversation) {
        handleSelectConversation(result.conversation);
      } else if (result.conversationId) {
        // Otherwise, find it in the refreshed list after a short delay
        setTimeout(() => {
          const conv = allConversations.find(
            (c) => c.id === result.conversationId
          );
          if (conv) {
            handleSelectConversation(conv);
          }
        }, 500);
      }
    } else {
      alert(`Failed to start conversation: ${result.error}`);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-6rem)] overflow-hidden relative md:rounded-2xl md:border md:border-gray-200 md:bg-white md:shadow-sm">
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
          onNewConversation={handleNewConversation}
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
            className="absolute top-[14px] left-3 z-10 p-1.5 text-gray-600 hover:bg-gray-100 rounded-full transition-colors active:scale-95"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>
          <MessageThread
            conversation={selectedConversation}
            currentUserId={userId}
            onUnreadCountUpdate={onUpdateUnreadCount}
          />
        </div>
      )}

      {/* New Conversation Modal */}
      <NewConversationModal
        isOpen={showNewConversationModal}
        onClose={() => setShowNewConversationModal(false)}
        onSelectUser={handleSelectNewConversationUser}
        currentUserId={userId}
        currentUserRole={userRole}
      />
    </div>
  );
}
