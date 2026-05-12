import React, { useState, useMemo } from "react";
import { X, Search, Loader2, MessageCircle, Users } from "lucide-react";
import {
  useOrganizationMembers,
  OrganizationMember,
} from "../hooks/useOrganizationMembers";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { UserRole } from "../types";
import { canMessageRole } from "../lib/messagingPermissions";
import { getRoleBadgeClasses } from "../lib/roleStyles";

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (user: OrganizationMember) => void;
  currentUserId: string;
  currentUserRole: UserRole;
}

export default function NewConversationModal({
  isOpen,
  onClose,
  onSelectUser,
  currentUserId,
  currentUserRole,
}: NewConversationModalProps) {
  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  const [searchQuery, setSearchQuery] = useState("");
  const { members, loading, error } = useOrganizationMembers({
    excludeCurrentUser: true,
  });

  // Apply messaging permission matrix first, then search filter
  const filteredMembers = useMemo(() => {
    const allowed = members.filter((m) =>
      canMessageRole(currentUserRole, m.role as UserRole)
    );

    if (!searchQuery.trim()) return allowed;

    const query = searchQuery.toLowerCase();
    return allowed.filter((member) => {
      const fullName = `${member.first_name || ""} ${
        member.last_name || ""
      }`.toLowerCase();
      const email = member.email?.toLowerCase() || "";
      const role = member.role?.toLowerCase() || "";

      return (
        fullName.includes(query) ||
        email.includes(query) ||
        role.includes(query)
      );
    });
  }, [members, searchQuery, currentUserRole]);

  const getInitials = (member: OrganizationMember) => {
    const firstName = member.first_name || "";
    const lastName = member.last_name || "";
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "?";
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            New Conversation
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              autoFocus
            />
          </div>
        </div>

        {/* Members List */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <Users className="w-12 h-12 text-red-300 mb-3" />
              <h3 className="text-sm font-medium text-red-900 mb-1">
                Error Loading Members
              </h3>
              <p className="text-xs text-red-600 text-center mb-2">{error}</p>
              <p className="text-xs text-gray-500 text-center">
                This may be an RLS policy issue. Check the browser console for
                details.
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <MessageCircle className="w-12 h-12 text-gray-300 mb-3" />
              <h3 className="text-sm font-medium text-gray-900 mb-1">
                {searchQuery ? "No members found" : "No team members"}
              </h3>
              <p className="text-xs text-gray-500 text-center">
                {searchQuery
                  ? "Try a different search term"
                  : "There are no other team members in your organization"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredMembers.map((member) => (
                <button
                  key={member.id}
                  onClick={() => onSelectUser(member)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors text-left"
                >
                  {/* Avatar */}
                  {member.avatar_url ? (
                    <img
                      src={member.avatar_url}
                      alt={`${member.first_name} ${member.last_name}`}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                      {getInitials(member)}
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {member.first_name} {member.last_name}
                      </p>
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getRoleBadgeClasses(
                          member.role
                        )}`}
                      >
                        {member.role}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {member.email}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
