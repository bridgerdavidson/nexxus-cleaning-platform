"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  Users,
  Plus,
  Trash2,
  Settings,
  UserCheck,
  Mail,
  Phone,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import { TeamMember, deleteTeamMember } from "../hooks/useAdminData";
import { useAuth } from "../hooks/useAuth";
import AddTeamMemberModal from "./AddTeamMemberModal";
import { useReopenableModalUrl } from "../hooks/useReopenableModalUrl";
import DeleteConfirmModal from "./DeleteConfirmModal";
import TeamMemberSidePanel from "./TeamMemberSidePanel";

interface TeamMembersPageProps {
  teamMembers: TeamMember[];
  loading: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onMemberUpdated?: (memberId: string, updatedData: Partial<TeamMember>) => void;
}

export default function TeamMembersPage({
  teamMembers,
  loading,
  error,
  onRefresh,
  onMemberUpdated,
}: TeamMembersPageProps) {
  const router = useRouter();
  const { currentOrganizationId, user } = useAuth();

  const canManagePermissionsForMember = (member: TeamMember) =>
    member.role === "manager" && member.id !== user?.id;

  const canDeleteMember = (member: TeamMember) =>
    member.id !== user?.id;

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "cleaner" | "manager" | "admin">(
    "all"
  );

  // Modal state
  const [showAddTeamMemberModal, setShowAddTeamMemberModal] = useState(false);
  // Keep the add-team-member modal's open state in the URL so a reload reopens it
  // and AddTeamMemberModal restores its saved draft.
  const {
    isOpenFromUrl: addTmOpenFromUrl,
    openModalUrl: openAddTmUrl,
    closeModalUrl: closeAddTmUrl,
  } = useReopenableModalUrl("add-team-member");

  // Side panel state
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);

  // Delete modal state
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    memberId: string | null;
    memberName: string;
  }>({
    isOpen: false,
    memberId: null,
    memberName: "",
  });
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter and sort team members
  const filteredMembers = useMemo(() => {
    let result = [...teamMembers];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((member) => {
        const fullName = `${member.user_profile?.first_name || ""} ${
          member.user_profile?.last_name || ""
        }`.toLowerCase();
        const email = (member.user_profile?.email || "").toLowerCase();
        const phone = (member.user_profile?.phone || "").toLowerCase();
        return (
          fullName.includes(query) ||
          email.includes(query) ||
          phone.includes(query)
        );
      });
    }

    // Role filter
    if (roleFilter !== "all") {
      result = result.filter((member) => member.role === roleFilter);
    }

    // Sort by name
    result.sort((a, b) => {
      const nameA = `${a.user_profile?.first_name || ""} ${
        a.user_profile?.last_name || ""
      }`.toLowerCase();
      const nameB = `${b.user_profile?.first_name || ""} ${
        b.user_profile?.last_name || ""
      }`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return result;
  }, [teamMembers, searchQuery, roleFilter]);

  // Handle delete
  const handleDeleteClick = (member: TeamMember) => {
    if (!currentOrganizationId || !canDeleteMember(member)) return;

    setDeleteConfirmModal({
      isOpen: true,
      memberId: member.id,
      memberName:
        `${member.user_profile?.first_name || ""} ${
          member.user_profile?.last_name || ""
        }`.trim() || "Team Member",
    });
    setIsSidePanelOpen(false);
  };

  const handleDeleteConfirm = async () => {
    if (
      !deleteConfirmModal.memberId ||
      !currentOrganizationId ||
      deleteConfirmModal.memberId === user?.id
    ) {
      return;
    }

    setIsDeleting(true);
    const result = await deleteTeamMember(
      deleteConfirmModal.memberId,
      currentOrganizationId
    );
    setIsDeleting(false);

    if (result.success) {
      setDeleteConfirmModal({
        isOpen: false,
        memberId: null,
        memberName: "",
      });
      if (onRefresh) onRefresh();
    } else {
      alert("Failed to delete team member: " + result.error);
    }
  };

  // Handle permissions — navigates to /settings/team/[managerId]. This used to
  // open a modal; the editor moved into the settings family so admins / owners
  // can deep-link straight to a permissions page.
  const handleManagePermissions = (member: TeamMember) => {
    setIsSidePanelOpen(false);
    router.push(`/settings/team/${member.id}`);
  };

  // Handle card click to open side panel
  const handleCardClick = (member: TeamMember) => {
    setSelectedMember(member);
    setIsSidePanelOpen(true);
  };

  // Get permissions count for managers
  const getPermissionsCount = (member: TeamMember) => {
    if (member.role !== "manager" || !member.permissions) return null;
    const enabled = Object.values(member.permissions).filter(Boolean).length;
    const total = Object.keys(member.permissions).length;
    return { enabled, total };
  };

  // Get initials for avatar
  const getInitials = (member: TeamMember) => {
    const first = member.user_profile?.first_name?.[0] || "";
    const last = member.user_profile?.last_name?.[0] || "";
    return `${first}${last}`.toUpperCase() || "?";
  };

  const stats = useMemo(() => {
    const cleaners = teamMembers.filter((m) => m.role === "cleaner").length;
    const managers = teamMembers.filter((m) => m.role === "manager").length;
    const admins = teamMembers.filter((m) => m.role === "admin").length;
    return { cleaners, managers, admins, total: teamMembers.length };
  }, [teamMembers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold text-gray-900">Team Members</h2>
          <p className="text-gray-600 mt-1 hidden md:block">
            Manage your team of cleaners, managers, and admins
          </p>
        </div>
        <button
          onClick={() => { setShowAddTeamMemberModal(true); openAddTmUrl(); }}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
        >
          <Plus className="w-5 h-5" />
          <span>New</span>
        </button>
      </div>

      {/* Search Input - Own line on mobile */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Filters Row - Mobile: Filters inline, Desktop: All in one line with search */}
      <div className="flex flex-row gap-3 overflow-x-auto">
        {/* Search Input - Desktop only (in same line as filters) */}
        <div className="hidden md:flex flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        {/* Role Filter Dropdown */}
        <div className="relative flex-shrink-0 min-w-[140px]">
          <select
            value={roleFilter}
            onChange={(e) =>
              setRoleFilter(e.target.value as "all" | "cleaner" | "manager" | "admin")
            }
            className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
          >
            <option value="all">All Roles</option>
            <option value="cleaner">Cleaners</option>
            <option value="manager">Managers</option>
            <option value="admin">Admins</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <Users className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Members</p>
              <p className="text-xl font-bold text-gray-900">{stats.total}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <UserCheck className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Cleaners</p>
              <p className="text-xl font-bold text-gray-900">
                {stats.cleaners}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Settings className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Managers</p>
              <p className="text-xl font-bold text-gray-900">
                {stats.managers}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <ShieldCheck className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Admins</p>
              <p className="text-xl font-bold text-gray-900">
                {stats.admins}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Team Members List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading team members...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Error loading team members
          </h3>
          <p className="text-gray-600">{error}</p>
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ? "No team members found" : "No team members yet"}
          </h3>
          <p className="text-gray-600">
            {searchQuery
              ? "Try adjusting your search query"
              : "Add your first team member to get started"}
          </p>
          {!searchQuery && (
            <button
              onClick={() => { setShowAddTeamMemberModal(true); openAddTmUrl(); }}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Team Member
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredMembers.map((member) => {
            const permissionsCount = getPermissionsCount(member);
            const initials = getInitials(member);

            return (
              <div
                key={member.id}
                onClick={() => handleCardClick(member)}
                className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 relative cursor-pointer"
              >
                {/* Action buttons - stop propagation to prevent card click */}
                <div
                  className="absolute top-4 right-4 flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canManagePermissionsForMember(member) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleManagePermissions(member);
                      }}
                      className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"
                      aria-label="Manage Permissions"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                  {canDeleteMember(member) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(member);
                      }}
                      className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"
                      aria-label="Delete Team Member"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {/* Avatar and Name */}
                <div className="flex items-start gap-3 mb-4 pr-20">
                  {member.user_profile?.avatar_url ? (
                    <img
                      src={member.user_profile.avatar_url}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-600 font-semibold text-sm">
                        {initials}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 truncate">
                      {member.user_profile?.first_name}{" "}
                      {member.user_profile?.last_name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          member.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : member.role === "manager"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {member.role === "admin"
                          ? "Admin"
                          : member.role === "manager"
                          ? "Manager"
                          : "Cleaner"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span className="truncate">
                      {member.user_profile?.email}
                    </span>
                  </div>
                  {member.user_profile?.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4 text-gray-400" />
                      <span>{member.user_profile.phone}</span>
                    </div>
                  )}
                </div>

                {/* Role-specific info */}
                {member.role === "cleaner" && member.cleaner_profile && (
                  <div className="flex items-center flex-wrap gap-3 pt-4 border-t border-gray-100">
                    {member.cleaner_profile.is_available ? (
                      <div className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle className="w-3 h-3 flex-shrink-0" />
                        <span>Available</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">Unavailable</span>
                    )}
                  </div>
                )}

                {member.role === "manager" && permissionsCount && (
                  <div className="pt-4 border-t border-gray-100">
                    <div className="text-sm text-gray-600">
                      <span className="font-semibold text-gray-900">
                        {permissionsCount.enabled}
                      </span>{" "}
                      of{" "}
                      <span className="font-semibold text-gray-900">
                        {permissionsCount.total}
                      </span>{" "}
                      permissions enabled
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <AddTeamMemberModal
        isOpen={showAddTeamMemberModal || addTmOpenFromUrl}
        onClose={() => { setShowAddTeamMemberModal(false); closeAddTmUrl(); }}
        onTeamMemberCreated={() => {
          if (onRefresh) onRefresh();
        }}
      />

      <DeleteConfirmModal
        isOpen={deleteConfirmModal.isOpen}
        onClose={() =>
          setDeleteConfirmModal({
            isOpen: false,
            memberId: null,
            memberName: "",
          })
        }
        onConfirm={handleDeleteConfirm}
        title="Delete Team Member"
        message="Are you sure you want to remove this team member from your organization? This action cannot be undone."
        itemName={deleteConfirmModal.memberName}
        isLoading={isDeleting}
      />

      {/* Team Member Side Panel */}
      <TeamMemberSidePanel
        isOpen={isSidePanelOpen}
        onClose={() => {
          setIsSidePanelOpen(false);
          setSelectedMember(null);
        }}
        member={selectedMember}
        currentUserId={user?.id}
        onDelete={(member) => handleDeleteClick(member)}
        onManagePermissions={(member) => handleManagePermissions(member)}
        onMemberUpdated={(updatedMember) => {
          // Update selected member immediately for side panel display
          setSelectedMember(updatedMember);
          // Update the member in the parent list without refetch
          if (onMemberUpdated) {
            onMemberUpdated(updatedMember.id, updatedMember);
          } else if (onRefresh) {
            // Fallback to full refresh if selective update not available
            onRefresh();
          }
        }}
      />
    </div>
  );
}
