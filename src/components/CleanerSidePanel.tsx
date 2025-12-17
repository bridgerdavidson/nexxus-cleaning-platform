"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  User,
  Mail,
  Phone,
  Edit2,
  Trash2,
  Star,
  CheckCircle,
  UserCheck,
  Save,
  Loader2,
  Clock,
  DollarSign,
} from "lucide-react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface CleanerProfile {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    avatar_url?: string;
  } | null;
  rating: number;
  total_jobs: number;
  is_available: boolean;
  experience_years?: number;
  hourly_rate?: number;
  background_check_verified: boolean;
  insurance_verified: boolean;
}

interface CleanerSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  cleaner: CleanerProfile | null;
  onDelete?: (cleaner: CleanerProfile) => void;
  onCleanerUpdated?: (updatedCleaner: CleanerProfile) => void;
}

export default function CleanerSidePanel({
  isOpen,
  onClose,
  cleaner,
  onDelete,
  onCleanerUpdated,
}: CleanerSidePanelProps) {
  // Lock body scroll when panel is open
  useBodyScrollLock(isOpen);

  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedCleaner, setEditedCleaner] = useState({
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

  // Update edited cleaner when cleaner prop changes
  useEffect(() => {
    if (cleaner) {
      setEditedCleaner({
        first_name: cleaner.user_profile?.first_name || "",
        last_name: cleaner.user_profile?.last_name || "",
        email: cleaner.user_profile?.email || "",
        phone: cleaner.user_profile?.phone || "",
      });
    }
  }, [cleaner]);

  // Reset editing state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
    }
  }, [isOpen]);

  if (!mounted || (!isOpen && !isAnimating) || !cleaner) return null;

  const getInitials = () => {
    const first = cleaner.user_profile?.first_name?.[0] || "";
    const last = cleaner.user_profile?.last_name?.[0] || "";
    return `${first}${last}`.toUpperCase() || "?";
  };

  const getName = () => {
    if (cleaner.user_profile) {
      return `${cleaner.user_profile.first_name} ${cleaner.user_profile.last_name}`;
    }
    return "Unknown";
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
    if (!cleaner || !cleaner.user_profile) return;

    setIsSaving(true);
    try {
      const { error, data: updateData } = await supabase
        .from("user_profiles")
        .update({
          first_name: editedCleaner.first_name,
          last_name: editedCleaner.last_name,
          email: editedCleaner.email,
          phone: editedCleaner.phone || null,
        })
        .eq("id", cleaner.id)
        .select()
        .single();

      if (error) {
        console.error("Error updating cleaner:", error);
        throw error;
      }

      if (!updateData) {
        console.warn("No rows updated for cleaner:", cleaner.id);
        alert(
          "Failed to update cleaner: No rows were updated. This may be due to RLS policies."
        );
        return;
      }

      // Merge updated data with existing cleaner data
      const updatedCleaner: CleanerProfile = {
        ...cleaner,
        user_profile: {
          ...cleaner.user_profile,
          first_name: updateData.first_name,
          last_name: updateData.last_name,
          email: updateData.email,
          phone: updateData.phone,
        },
      };

      setIsEditing(false);
      if (onCleanerUpdated) {
        onCleanerUpdated(updatedCleaner);
      }
    } catch (error) {
      console.error("Failed to update cleaner:", error);
      alert(
        "Failed to update cleaner: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (cleaner) {
      setEditedCleaner({
        first_name: cleaner.user_profile?.first_name || "",
        last_name: cleaner.user_profile?.last_name || "",
        email: cleaner.user_profile?.email || "",
        phone: cleaner.user_profile?.phone || "",
      });
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(cleaner);
    }
  };

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
            {getName()}'s Profile
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
              {cleaner.user_profile?.avatar_url ? (
                <img
                  src={cleaner.user_profile.avatar_url}
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
                        {cleaner.user_profile?.first_name}{" "}
                        {cleaner.user_profile?.last_name}
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
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50"
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
                      cleaner.is_available
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {cleaner.is_available ? "Available" : "Unavailable"}
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
                    value={editedCleaner.first_name}
                    onChange={(e) =>
                      setEditedCleaner({
                        ...editedCleaner,
                        first_name: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {cleaner.user_profile?.first_name || "—"}
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
                    value={editedCleaner.last_name}
                    onChange={(e) =>
                      setEditedCleaner({
                        ...editedCleaner,
                        last_name: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {cleaner.user_profile?.last_name || "—"}
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
                    value={editedCleaner.email}
                    onChange={(e) =>
                      setEditedCleaner({
                        ...editedCleaner,
                        email: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {cleaner.user_profile?.email || "Not provided"}
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
                    value={editedCleaner.phone}
                    onChange={(e) =>
                      setEditedCleaner({
                        ...editedCleaner,
                        phone: e.target.value,
                      })
                    }
                    placeholder="(555) 123-4567"
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="text-gray-900 font-medium mt-1">
                    {cleaner.user_profile?.phone || "Not provided"}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Cleaner Profile Information */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900">
              Cleaner Profile
            </h4>

            {/* Rating */}
            <div className="flex items-center gap-3">
              <Star className="w-5 h-5 text-yellow-400 fill-current flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Rating</p>
                <p className="font-medium text-gray-900">
                  {cleaner.rating.toFixed(1)} / 5.0
                </p>
              </div>
            </div>

            {/* Total Jobs */}
            <div className="flex items-center gap-3">
              <UserCheck className="w-5 h-5 text-gray-500 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Total Jobs</p>
                <p className="font-medium text-gray-900">
                  {cleaner.total_jobs}
                </p>
              </div>
            </div>

            {/* Experience */}
            {cleaner.experience_years && (
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">Experience</p>
                  <p className="font-medium text-gray-900">
                    {cleaner.experience_years} years
                  </p>
                </div>
              </div>
            )}

            {/* Hourly Rate */}
            {cleaner.hourly_rate && (
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">Hourly Rate</p>
                  <p className="font-medium text-gray-900">
                    ${cleaner.hourly_rate}/hr
                  </p>
                </div>
              </div>
            )}

            {/* Status */}
            <div className="flex items-center gap-3">
              <CheckCircle
                className={`w-5 h-5 flex-shrink-0 ${
                  cleaner.is_available ? "text-green-600" : "text-gray-400"
                }`}
              />
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p
                  className={`font-medium ${
                    cleaner.is_available ? "text-green-600" : "text-gray-600"
                  }`}
                >
                  {cleaner.is_available ? "Available" : "Unavailable"}
                </p>
              </div>
            </div>

            {/* Verification Badges */}
            {(cleaner.background_check_verified ||
              cleaner.insurance_verified) && (
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <p className="text-sm text-gray-500">Verification</p>
                <div className="flex flex-wrap gap-2">
                  {cleaner.background_check_verified && (
                    <span className="inline-flex items-center px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Background Check
                    </span>
                  )}
                  {cleaner.insurance_verified && (
                    <span className="inline-flex items-center px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Insured
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Footer */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 p-4 sm:p-6 shadow-lg space-y-2">
          <div className="flex flex-col lg:flex-row gap-2">
            {onDelete && (
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
