"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  User,
  Mail,
  Phone,
  Edit,
  Edit2,
  Trash2,
  Settings,
  CheckCircle,
  Save,
  Loader2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { TeamMember } from "../hooks/useAdminData";
import { supabase } from "../lib/supabase";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface TeamMemberSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  member: TeamMember | null;
  /** When set, hides "Manage Permissions" for this user (e.g. viewing your own row). */
  currentUserId?: string | null;
  onEdit?: (member: TeamMember) => void;
  onDelete?: (member: TeamMember) => void;
  onManagePermissions?: (member: TeamMember) => void;
  onMemberUpdated?: (updatedMember: TeamMember) => void;
}

export default function TeamMemberSidePanel({
  isOpen,
  onClose,
  member,
  currentUserId,
  onEdit,
  onDelete,
  onManagePermissions,
  onMemberUpdated,
}: TeamMemberSidePanelProps) {
  // Lock body scroll when panel is open
  useBodyScrollLock(isOpen);

  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedMember, setEditedMember] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Start animating when opened
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
    }
  }, [isOpen]);

  // Update edited member when member prop changes
  useEffect(() => {
    if (member) {
      setEditedMember({
        first_name: member.user_profile?.first_name || "",
        last_name: member.user_profile?.last_name || "",
        email: member.user_profile?.email || "",
        phone: member.user_profile?.phone || "",
      });
    }
  }, [member]);

  // Reset editing state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
    }
  }, [isOpen]);

  if (!mounted || (!isOpen && !isAnimating) || !member) return null;

  const getInitials = () => {
    const first = member.user_profile?.first_name?.[0] || "";
    const last = member.user_profile?.last_name?.[0] || "";
    return `${first}${last}`.toUpperCase() || "?";
  };

  const getPermissionsCount = () => {
    if (member.role !== "manager" || !member.permissions) return null;
    const enabled = Object.values(member.permissions).filter(Boolean).length;
    const total = Object.keys(member.permissions).length;
    return { enabled, total };
  };

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => {
      onClose();
    }, 300); // match duration-300
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!member) return;

    setIsSaving(true);
    try {
      const { error, data: updateData } = await supabase
        .from("user_profiles")
        .update({
          first_name: editedMember.first_name,
          last_name: editedMember.last_name,
          email: editedMember.email,
          phone: editedMember.phone || null,
        })
        .eq("id", member.id)
        .select()
        .single();

      if (error) {
        console.error("Error updating team member:", error);
        throw error;
      }

      if (!updateData) {
        console.warn("No rows updated for team member:", member.id);
        alert(
          "Failed to update team member: No rows were updated. This may be due to RLS policies."
        );
        return;
      }

      // Merge updated data with existing member data
      const updatedMember: TeamMember = {
        ...member,
        user_profile: member.user_profile
          ? {
              ...member.user_profile,
              first_name: updateData.first_name,
              last_name: updateData.last_name,
              email: updateData.email,
              phone: updateData.phone,
            }
          : null,
      };

      setIsEditing(false);
      if (onMemberUpdated) {
        onMemberUpdated(updatedMember);
      }
    } catch (error) {
      console.error("Failed to update team member:", error);
      alert(
        "Failed to update team member: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (member) {
      setEditedMember({
        first_name: member.user_profile?.first_name || "",
        last_name: member.user_profile?.last_name || "",
        email: member.user_profile?.email || "",
        phone: member.user_profile?.phone || "",
      });
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(member);
    }
  };

  const handleManagePermissions = () => {
    if (onManagePermissions) {
      onManagePermissions(member);
    }
  };

  const permissionsCount = getPermissionsCount();
  const showManagePermissions =
    member.role === "manager" &&
    onManagePermissions &&
    member.id !== currentUserId;

  const showDelete =
    onDelete &&
    member.id !== currentUserId;

  const panel = (
    <div
      className={`fixed inset-0 z-[200] flex justify-end transition-colors duration-300 ${
        isOpen && isAnimating ? "bg-black/50" : "bg-transparent"
      }`}
      onClick={handleClose}
    >
      {/* Side Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`h-screen w-full sm:w-[450px] lg:w-[600px] bg-white shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${
          isOpen && isAnimating ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 p-4 sm:p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            Team Member Details
          </h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 pb-6">
          {/* Avatar and Name */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              {member.user_profile?.avatar_url ? (
                <img
                  src={member.user_profile.avatar_url}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center">
                  <span className="text-primary-600 font-semibold text-2xl">
                    {getInitials()}
                  </span>
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold text-gray-900">
                    {isEditing ? (
                      <span className="text-gray-400">Editing...</span>
                    ) : (
                      <>
                        {member.user_profile?.first_name}{" "}
                        {member.user_profile?.last_name}
                      </>
                    )}
                  </h3>
                  {!isEditing ? (
                    <button
                      onClick={handleEdit}
                      className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit Info
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancel}
                        className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="btn-primary-chrome flex items-center gap-2 px-3 py-1.5 text-sm"
                      >
                        {isSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Save
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
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
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900">
              Contact Information
            </h4>

            {/* First Name */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-gray-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500">First Name</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedMember.first_name}
                    onChange={(e) =>
                      setEditedMember({
                        ...editedMember,
                        first_name: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {member.user_profile?.first_name || "—"}
                  </p>
                )}
              </div>
            </div>

            {/* Last Name */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-gray-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500">Last Name</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedMember.last_name}
                    onChange={(e) =>
                      setEditedMember({
                        ...editedMember,
                        last_name: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {member.user_profile?.last_name || "—"}
                  </p>
                )}
              </div>
            </div>

            {/* Email */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                <Mail className="w-5 h-5 text-gray-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500">Email</p>
                {isEditing ? (
                  <input
                    type="email"
                    value={editedMember.email}
                    onChange={(e) =>
                      setEditedMember({
                        ...editedMember,
                        email: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {member.user_profile?.email || "Not provided"}
                  </p>
                )}
              </div>
            </div>

            {/* Phone */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                <Phone className="w-5 h-5 text-gray-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500">Phone</p>
                {isEditing ? (
                  <input
                    type="tel"
                    value={editedMember.phone}
                    onChange={(e) =>
                      setEditedMember({
                        ...editedMember,
                        phone: e.target.value,
                      })
                    }
                    placeholder="(555) 123-4567"
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {member.user_profile?.phone || "Not provided"}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Role-specific Information */}
          {member.role === "cleaner" && member.cleaner_profile && (
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-gray-900">
                Cleaner Profile
              </h4>

              <div className="flex items-center gap-3">
                <CheckCircle
                  className={`w-5 h-5 flex-shrink-0 ${
                    member.cleaner_profile.is_available
                      ? "text-green-600"
                      : "text-gray-400"
                  }`}
                />
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p
                    className={`font-medium ${
                      member.cleaner_profile.is_available
                        ? "text-green-600"
                        : "text-gray-600"
                    }`}
                  >
                    {member.cleaner_profile.is_available
                      ? "Available"
                      : "Unavailable"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {member.role === "manager" && permissionsCount && (
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-gray-900">
                Permissions
              </h4>

              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">Access Level</p>
                  <p className="font-medium text-gray-900">
                    {permissionsCount.enabled} of {permissionsCount.total}{" "}
                    permissions enabled
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Footer */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 p-4 sm:p-6 shadow-lg space-y-2">
          <div className="flex flex-col lg:flex-row gap-2">
            {showManagePermissions && (
              <button
                onClick={handleManagePermissions}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-blue-500 text-blue-700 bg-transparent rounded-lg hover:bg-blue-50 transition-colors font-medium"
              >
                <Settings className="w-4 h-4" />
                Manage Permissions
              </button>
            )}

            {showDelete && (
              <button
                onClick={handleDelete}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-red-500 text-red-700 bg-transparent rounded-lg hover:bg-red-50 transition-colors font-medium"
              >
                <Trash2 className="w-4 h-4" />
                Delete Profile
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
