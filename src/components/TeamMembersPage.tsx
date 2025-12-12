"use client";

import React, { useState, useMemo } from "react";
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
  Star,
  CheckCircle,
} from "lucide-react";
import { TeamMember, deleteTeamMember } from "../hooks/useAdminData";
import { useAuth } from "../hooks/useAuth";
import AddTeamMemberModal from "./AddTeamMemberModal";
import ManagerPermissionsModal from "./ManagerPermissionsModal";
import DeleteConfirmModal from "./DeleteConfirmModal";
import TeamMemberSidePanel from "./TeamMemberSidePanel";

interface TeamMembersPageProps {
  teamMembers: TeamMember[];
  loading: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export default function TeamMembersPage({
  teamMembers,
  loading,
  error,
  onRefresh,
}: TeamMembersPageProps) {
  const { currentOrganizationId } = useAuth();

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "cleaner" | "manager">(
    "all"
  );

  // Modal state
  const [showAddTeamMemberModal, setShowAddTeamMemberModal] = useState(false);
  const [selectedManager, setSelectedManager] = useState<TeamMember | null>(
    null
  );
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);

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
    if (!currentOrganizationId) return;

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
    if (!deleteConfirmModal.memberId || !currentOrganizationId) return;

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

  // Handle permissions
  const handleManagePermissions = (member: TeamMember) => {
    setSelectedManager(member);
    setShowPermissionsModal(true);
    setIsSidePanelOpen(false);
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
    return { cleaners, managers, total: teamMembers.length };
  }, [teamMembers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Team Members</h2>
          <p className="text-gray-600 mt-1">
            Manage your team of cleaners and managers
          </p>
        </div>
        <button
          onClick={() => setShowAddTeamMemberModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add Team Member
        </button>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search Input */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
          />
        </div>

        {/* Role Filter Dropdown */}
        <select
          value={roleFilter}
          onChange={(e) =>
            setRoleFilter(e.target.value as "all" | "cleaner" | "manager")
          }
          className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        >
          <option value="all">All Roles</option>
          <option value="cleaner">Cleaners</option>
          <option value="manager">Managers</option>
        </select>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
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
        <div className="bg-white rounded-lg border border-gray-200 p-4">
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
        <div className="bg-white rounded-lg border border-gray-200 p-4">
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
      </div>

      {/* Team Members List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading team members...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Error loading team members
          </h3>
          <p className="text-gray-600">{error}</p>
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
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
              onClick={() => setShowAddTeamMemberModal(true)}
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
                className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow relative cursor-pointer"
              >
                {/* Action buttons - stop propagation to prevent card click */}
                <div
                  className="absolute top-4 right-4 flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {member.role === "manager" && (
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
                          member.role === "manager"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {member.role === "manager" ? "Manager" : "Cleaner"}
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
                    <div className="flex items-center gap-1.5">
                      <Star className="w-4 h-4 text-yellow-400 fill-current flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-900">
                        {member.cleaner_profile.rating.toFixed(1)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {member.cleaner_profile.total_jobs} jobs
                    </div>
                    {member.cleaner_profile.is_available && (
                      <div className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle className="w-3 h-3 flex-shrink-0" />
                        <span>Available</span>
                      </div>
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
        isOpen={showAddTeamMemberModal}
        onClose={() => setShowAddTeamMemberModal(false)}
        onTeamMemberCreated={() => {
          if (onRefresh) onRefresh();
        }}
      />

      <ManagerPermissionsModal
        isOpen={showPermissionsModal}
        onClose={() => {
          setShowPermissionsModal(false);
          setSelectedManager(null);
        }}
        manager={selectedManager}
        onPermissionsUpdated={() => {
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
        onDelete={(member) => handleDeleteClick(member)}
        onManagePermissions={(member) => handleManagePermissions(member)}
        onMemberUpdated={() => {
          if (onRefresh) onRefresh();
        }}
      />
    </div>
  );
}
