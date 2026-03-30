"use client";

import React, { useState, useMemo } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Search,
  User,
  Mail,
  Phone,
  UserCheck,
  Clock,
  DollarSign,
  Percent,
  Link2,
  CheckCircle,
  Trash2,
  Edit2,
  Save,
  Loader2,
  AlertCircle,
  Users,
  Plus,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CleanerProfile {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    avatar_url?: string | null;
  } | null;
  rating: number;
  total_jobs: number;
  is_available: boolean;
  experience_years?: number;
  hourly_rate?: number;
  background_check_verified: boolean;
  insurance_verified: boolean;
  payout_percent: number;
  stripe_connect_account_id?: string | null;
  stripe_connect_onboarding_complete?: boolean;
}

interface CleanerManagementPageProps {
  cleaners: CleanerProfile[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  onCleanerUpdated: (updatedCleaner: CleanerProfile) => void;
  onDeleteRequest: (cleanerId: string, cleanerName: string) => void;
  onAddCleaner: () => void;
  onBulkPayoutsUpdated: (
    updates: { id: string; payout_percent: number }[],
  ) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(cleaner: CleanerProfile): string {
  const first = cleaner.user_profile?.first_name?.[0] ?? "";
  const last = cleaner.user_profile?.last_name?.[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}

function getFullName(cleaner: CleanerProfile): string {
  const p = cleaner.user_profile;
  return p ? `${p.first_name} ${p.last_name}` : "Unknown";
}

function CleanerAvatar({
  cleaner,
  size = "sm",
}: {
  cleaner: CleanerProfile;
  size?: "sm" | "lg";
}) {
  const cls =
    size === "lg"
      ? "w-20 h-20 text-2xl font-bold"
      : "w-11 h-11 text-sm font-semibold";
  if (cleaner.user_profile?.avatar_url) {
    return (
      <img
        src={cleaner.user_profile.avatar_url}
        alt=""
        className={`${cls} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${cls} bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0`}
    >
      <span className="text-primary-600">{getInitials(cleaner)}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CleanerManagementPage({
  cleaners,
  loading,
  error,
  canManage,
  onCleanerUpdated,
  onDeleteRequest,
  onAddCleaner,
  onBulkPayoutsUpdated,
}: CleanerManagementPageProps) {
  // ── Navigation state ──────────────────────────────────────────────────────
  const [viewingCleaner, setViewingCleaner] = useState<CleanerProfile | null>(
    null,
  );

  // ── List / search state ───────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");

  // ── Payout mode state ─────────────────────────────────────────────────────
  const [isPayoutMode, setIsPayoutMode] = useState(false);
  const [payoutDraft, setPayoutDraft] = useState<Record<string, number>>({});
  const [applyAllValue, setApplyAllValue] = useState("");
  const [isSavingPayouts, setIsSavingPayouts] = useState(false);
  const [showSetAllSection, setShowSetAllSection] = useState(false);

  // ── Detail edit state ─────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedFields, setEditedFields] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    payout_percent: 0,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredCleaners = useMemo(() => {
    return cleaners.filter((c) => {
      const name = getFullName(c).toLowerCase();
      const email = (c.user_profile?.email ?? "").toLowerCase();
      const phone = (c.user_profile?.phone ?? "").toLowerCase();
      const q = searchQuery.toLowerCase();

      return (
        !searchQuery ||
        name.includes(q) ||
        email.includes(q) ||
        phone.includes(q)
      );
    });
  }, [cleaners, searchQuery]);

  // ── Search row (shared UI) ────────────────────────────────────────────────
  const renderFilters = () => (
    <>
      {/* Mobile-only search */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Desktop: search */}
      <div className="hidden md:block w-full relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>
    </>
  );

  // ── Payout mode handlers ──────────────────────────────────────────────────
  const handleEnterPayoutMode = () => {
    const draft: Record<string, number> = {};
    cleaners.forEach((c) => {
      draft[c.id] = c.payout_percent ?? 0;
    });
    setPayoutDraft(draft);
    setApplyAllValue("");
    setShowSetAllSection(false);
    setIsPayoutMode(true);
  };

  const handleCancelPayouts = () => {
    setIsPayoutMode(false);
    setPayoutDraft({});
    setApplyAllValue("");
    setShowSetAllSection(false);
  };

  const handleApplyToAll = () => {
    const val = parseFloat(applyAllValue);
    if (isNaN(val) || val < 0 || val > 100) return;
    const newDraft: Record<string, number> = {};
    cleaners.forEach((c) => {
      newDraft[c.id] = val;
    });
    setPayoutDraft(newDraft);
  };

  const handleSavePayouts = async () => {
    setIsSavingPayouts(true);
    try {
      const updates = cleaners.map((c) => ({
        cleaner_id: c.id,
        payout_percent: payoutDraft[c.id] ?? c.payout_percent ?? 0,
      }));

      const { error: rpcError } = await supabase.rpc(
        "bulk_update_cleaner_payouts",
        { updates },
      );

      if (rpcError) throw rpcError;

      onBulkPayoutsUpdated(
        updates.map((u) => ({
          id: u.cleaner_id,
          payout_percent: u.payout_percent,
        })),
      );

      setIsPayoutMode(false);
      setPayoutDraft({});
      setApplyAllValue("");
      setShowSetAllSection(false);
    } catch (err) {
      alert(
        "Failed to save payouts: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setIsSavingPayouts(false);
    }
  };

  // ── Detail view handlers ──────────────────────────────────────────────────
  const handleViewCleaner = (cleaner: CleanerProfile) => {
    setViewingCleaner(cleaner);
    setIsEditing(false);
    setEditedFields({
      first_name: cleaner.user_profile?.first_name ?? "",
      last_name: cleaner.user_profile?.last_name ?? "",
      email: cleaner.user_profile?.email ?? "",
      phone: cleaner.user_profile?.phone ?? "",
      payout_percent: cleaner.payout_percent ?? 0,
    });
  };

  const handleBackToList = () => {
    setViewingCleaner(null);
    setIsEditing(false);
  };

  const handleEditStart = () => {
    if (!viewingCleaner) return;
    setEditedFields({
      first_name: viewingCleaner.user_profile?.first_name ?? "",
      last_name: viewingCleaner.user_profile?.last_name ?? "",
      email: viewingCleaner.user_profile?.email ?? "",
      phone: viewingCleaner.user_profile?.phone ?? "",
      payout_percent: viewingCleaner.payout_percent ?? 0,
    });
    setIsEditing(true);
  };

  const handleEditCancel = () => {
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!viewingCleaner) return;
    setIsSaving(true);
    try {
      const { data: profileData, error: profileError } = await supabase
        .from("user_profiles")
        .update({
          first_name: editedFields.first_name,
          last_name: editedFields.last_name,
          email: editedFields.email,
          phone: editedFields.phone || null,
        })
        .eq("id", viewingCleaner.id)
        .select()
        .single();

      if (profileError) throw profileError;
      if (!profileData) {
        alert(
          "Failed to update cleaner: No rows were updated. This may be due to RLS policies.",
        );
        return;
      }

      const { error: payoutError } = await supabase
        .from("cleaner_profiles")
        .update({ payout_percent: editedFields.payout_percent })
        .eq("id", viewingCleaner.id);

      if (payoutError) {
        console.error("Error updating payout_percent:", payoutError);
      }

      const updatedCleaner: CleanerProfile = {
        ...viewingCleaner,
        payout_percent: editedFields.payout_percent,
        user_profile: {
          ...viewingCleaner.user_profile!,
          first_name: profileData.first_name,
          last_name: profileData.last_name,
          email: profileData.email,
          phone: profileData.phone ?? undefined,
        },
      };

      setViewingCleaner(updatedCleaner);
      setIsEditing(false);
      onCleanerUpdated(updatedCleaner);
    } catch (err) {
      alert(
        "Failed to update cleaner: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFromDetail = () => {
    if (!viewingCleaner) return;
    const name = getFullName(viewingCleaner);
    setViewingCleaner(null);
    onDeleteRequest(viewingCleaner.id, name);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // DETAIL VIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (viewingCleaner) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleBackToList}
            className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Back to list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <nav className="flex items-center text-sm">
            <button
              onClick={handleBackToList}
              className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              Cleaner Management
            </button>
            <ChevronRight className="w-4 h-4 mx-2 text-gray-400" />
            <span className="text-gray-600 font-medium truncate max-w-[200px] sm:max-w-none">
              {getFullName(viewingCleaner)}
            </span>
          </nav>
        </div>

        {/* Unified Profile Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Profile Header */}
          <div className="p-6 sm:p-8 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <CleanerAvatar cleaner={viewingCleaner} size="lg" />
              <div className="flex-1 min-w-0 w-full">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {isEditing
                        ? `${editedFields.first_name} ${editedFields.last_name}`.trim() ||
                          "Editing…"
                        : getFullName(viewingCleaner)}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                          viewingCleaner.is_available
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {viewingCleaner.is_available
                          ? "Available"
                          : "Unavailable"}
                      </span>
                      {viewingCleaner.background_check_verified && (
                        <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          Background Check
                        </span>
                      )}
                      {viewingCleaner.insurance_verified && (
                        <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          Insured
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  {canManage && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50 transition-colors"
                          >
                            {isSaving ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            Save
                          </button>
                          <button
                            onClick={handleEditCancel}
                            className="px-4 py-2 text-sm bg-white border-2 border-primary-600 text-primary-600 rounded-lg font-medium hover:bg-gray-50 transition-colors duration-200"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleEditStart}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border-2 border-primary-600 text-primary-600 rounded-lg font-medium hover:bg-gray-50 transition-colors duration-200"
                          >
                            <Edit2 className="w-4 h-4" />
                            Edit Info
                          </button>
                          <button
                            onClick={handleDeleteFromDetail}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-600 hover:text-red-700 border border-red-200 hover:border-red-400 bg-white rounded-lg font-medium transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Profile Details */}
          <div className="p-6 sm:p-8 bg-gray-50/30">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
              {/* Contact Information */}
              <div className="space-y-5">
                <h3 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">
                  Contact Information
                </h3>

                {(
                  [
                    {
                      icon: User,
                      label: "First Name",
                      field: "first_name",
                      value: viewingCleaner.user_profile?.first_name,
                      type: "text",
                    },
                    {
                      icon: User,
                      label: "Last Name",
                      field: "last_name",
                      value: viewingCleaner.user_profile?.last_name,
                      type: "text",
                    },
                    {
                      icon: Mail,
                      label: "Email",
                      field: "email",
                      value: viewingCleaner.user_profile?.email,
                      type: "email",
                    },
                    {
                      icon: Phone,
                      label: "Phone",
                      field: "phone",
                      value: viewingCleaner.user_profile?.phone,
                      type: "tel",
                      placeholder: "(555) 123-4567",
                    },
                  ] as Array<{
                    icon: React.ElementType;
                    label: string;
                    field: string;
                    value: string | undefined;
                    type: string;
                    placeholder?: string;
                  }>
                ).map(({ icon: Icon, label, field, value, type, placeholder }) => (
                  <div key={field} className="flex items-start gap-3">
                    <div className="w-9 h-9 bg-white border border-gray-200 shadow-sm rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                        {label}
                      </p>
                      {isEditing ? (
                        <input
                          type={type}
                          value={
                            editedFields[
                              field as keyof typeof editedFields
                            ] as string
                          }
                          onChange={(e) =>
                            setEditedFields((prev) => ({
                              ...prev,
                              [field]: e.target.value,
                            }))
                          }
                          placeholder={placeholder}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm transition-colors bg-white"
                        />
                      ) : (
                        <p className="text-gray-900 font-medium break-words">
                          {value || "—"}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Professional Details */}
              <div className="space-y-5">
                <h3 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">
                  Professional Details
                </h3>

                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-white border border-gray-200 shadow-sm rounded-lg flex items-center justify-center flex-shrink-0">
                    <UserCheck className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                      Total Jobs
                    </p>
                    <p className="text-gray-900 font-medium">
                      {viewingCleaner.total_jobs}
                    </p>
                  </div>
                </div>

                {!!viewingCleaner.experience_years && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-white border border-gray-200 shadow-sm rounded-lg flex items-center justify-center flex-shrink-0">
                      <Clock className="w-4 h-4 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                        Experience
                      </p>
                      <p className="text-gray-900 font-medium">
                        {viewingCleaner.experience_years} years
                      </p>
                    </div>
                  </div>
                )}

                {!!viewingCleaner.hourly_rate && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-white border border-gray-200 shadow-sm rounded-lg flex items-center justify-center flex-shrink-0">
                      <DollarSign className="w-4 h-4 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                        Hourly Rate
                      </p>
                      <p className="text-gray-900 font-medium">
                        ${viewingCleaner.hourly_rate}/hr
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment Settings */}
              <div className="space-y-5">
                <h3 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">
                  Payment Settings
                </h3>

                {/* Payout % */}
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-white border border-gray-200 shadow-sm rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Percent className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                      Payout Percentage
                    </p>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={editedFields.payout_percent}
                          onChange={(e) =>
                            setEditedFields((prev) => ({
                              ...prev,
                              payout_percent: parseFloat(e.target.value) || 0,
                            }))
                          }
                          className="w-24 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm transition-colors bg-white"
                        />
                        <span className="text-gray-500 text-sm">%</span>
                      </div>
                    ) : (
                      <p className="text-gray-900 font-medium">
                        {viewingCleaner.payout_percent ?? 0}% payout rate
                      </p>
                    )}
                  </div>
                </div>

                {/* Stripe Connect */}
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-white border border-gray-200 shadow-sm rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Link2 className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                      Stripe Connect
                    </p>
                    {viewingCleaner.stripe_connect_onboarding_complete ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                        <CheckCircle className="w-3 h-3" />
                        Connected
                      </span>
                    ) : viewingCleaner.stripe_connect_account_id ? (
                      <span className="inline-flex items-center px-3 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                        Onboarding Incomplete
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                        Not Connected
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAYOUT MODE
  // ─────────────────────────────────────────────────────────────────────────
  if (isPayoutMode) {
    return (
      <div className="space-y-6">
        {/* Breadcrumb + actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleCancelPayouts}
              disabled={isSavingPayouts}
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
              aria-label="Back to cleaner management"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <nav className="flex items-center text-sm flex-wrap gap-y-1">
              <button
                type="button"
                onClick={handleCancelPayouts}
                disabled={isSavingPayouts}
                className="text-primary-600 hover:text-primary-700 font-medium transition-colors disabled:opacity-50"
              >
                Cleaner Management
              </button>
              <ChevronRight className="w-4 h-4 mx-2 text-gray-400 flex-shrink-0" />
              <span className="text-gray-600 font-medium">Manage Payouts</span>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-3 flex-shrink-0 sm:ml-auto">
            <button
              type="button"
              onClick={() => setShowSetAllSection((open) => !open)}
              disabled={isSavingPayouts}
              aria-expanded={showSetAllSection}
              className="px-4 py-2.5 rounded-lg bg-white border-2 border-primary-600 text-primary-600 hover:bg-gray-50 font-medium transition-colors duration-200 text-sm disabled:opacity-50"
            >
              Set all
            </button>
            <button
              type="button"
              onClick={handleSavePayouts}
              disabled={isSavingPayouts}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors text-sm shadow-md disabled:opacity-50"
            >
              {isSavingPayouts ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={handleCancelPayouts}
              disabled={isSavingPayouts}
              className="px-4 py-2.5 rounded-lg bg-white border-2 border-primary-600 text-primary-600 hover:bg-gray-50 font-medium transition-colors duration-200 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Apply-to-all control (shown after "Set all") */}
        {showSetAllSection && (
          <div className="relative bg-primary-50 border border-primary-200 rounded-xl p-4 pr-11 sm:pr-12 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSetAllSection(false)}
              className="absolute top-1/2 right-3 -translate-y-1/2 p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-primary-100/80 transition-colors"
              aria-label="Close set all section"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-primary-900 whitespace-nowrap">
              Set all cleaners to:
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={applyAllValue}
                  onChange={(e) => setApplyAllValue(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-28 px-3 py-2 pr-7 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm bg-white"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">
                  %
                </span>
              </div>
              <button
                type="button"
                onClick={handleApplyToAll}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                Apply to All ({cleaners.length})
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        {renderFilters()}

        {/* Payout rows */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading cleaners…</span>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredCleaners.map((cleaner) => (
              <div
                key={cleaner.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4"
              >
                <CleanerAvatar cleaner={cleaner} />
                <span className="flex-1 font-medium text-gray-900 truncate">
                  {getFullName(cleaner)}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={
                      payoutDraft[cleaner.id] ?? cleaner.payout_percent ?? 0
                    }
                    onChange={(e) =>
                      setPayoutDraft((prev) => ({
                        ...prev,
                        [cleaner.id]: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="w-20 px-3 py-2 text-right border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm transition-colors"
                  />
                  <span className="text-gray-500 text-sm w-4">%</span>
                </div>
              </div>
            ))}
            {filteredCleaners.length === 0 && (
              <div className="text-center py-10 bg-white rounded-xl border border-gray-200">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">No cleaners match your search</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIST VIEW
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold text-gray-900">
            Cleaner Management
          </h2>
          <p className="text-gray-600 mt-1 hidden md:block">
            Manage your cleaning team
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={onAddCleaner}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors text-sm shadow-md whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Add Cleaner
            </button>
            <button
              onClick={handleEnterPayoutMode}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-white border-2 border-primary-600 text-primary-600 rounded-full font-medium hover:bg-gray-50 transition-colors duration-200 text-sm whitespace-nowrap"
            >
              <Percent className="w-4 h-4" />
              Manage Payouts
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      {renderFilters()}

      {/* Cleaner list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading cleaners…</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Error loading cleaners
          </h3>
          <p className="text-gray-600">{error}</p>
        </div>
      ) : filteredCleaners.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ? "No cleaners found" : "No cleaners yet"}
          </h3>
          <p className="text-gray-600">
            {searchQuery
              ? "Try adjusting your search"
              : "Add your first cleaner to get started"}
          </p>
          {!searchQuery && canManage && (
            <button
              onClick={onAddCleaner}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              <UserCheck className="w-5 h-5" />
              Add Cleaner
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCleaners.map((cleaner) => (
            <div
              key={cleaner.id}
              onClick={() => handleViewCleaner(cleaner)}
              className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer p-4 flex items-start md:items-center gap-4"
            >
              <CleanerAvatar cleaner={cleaner} />

              {/* Main content: stacked on mobile / sm; single row from md */}
              <div className="flex-1 min-w-0 flex flex-col gap-1.5 md:flex-row md:items-center md:gap-4 lg:gap-6">
                {/* Name + availability + verification */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="font-semibold text-gray-900 truncate max-w-[min(100%,14rem)] md:max-w-none">
                    {getFullName(cleaner)}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      cleaner.is_available
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {cleaner.is_available ? "Available" : "Unavailable"}
                  </span>
                  {cleaner.background_check_verified && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                      <CheckCircle className="w-3 h-3" />
                      Background Check
                    </span>
                  )}
                  {cleaner.insurance_verified && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                      <CheckCircle className="w-3 h-3" />
                      Insured
                    </span>
                  )}
                </div>

                {/* Contact */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 min-w-0 md:flex-1 md:min-w-[8rem]">
                  {cleaner.user_profile?.email && (
                    <span className="flex items-center gap-1 min-w-0">
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate max-w-[180px] md:max-w-[14rem] lg:max-w-xs">
                        {cleaner.user_profile.email}
                      </span>
                    </span>
                  )}
                  {cleaner.user_profile?.phone && (
                    <span className="hidden md:inline-flex items-center gap-1 shrink-0">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      {cleaner.user_profile.phone}
                    </span>
                  )}
                </div>

                {/* Stats: hidden below sm when stacked; inline in row from md */}
                <div className="hidden sm:flex flex-wrap items-center gap-4 text-sm text-gray-500 md:ml-auto shrink-0">
                  <span>{cleaner.total_jobs} jobs</span>
                  <span>{cleaner.payout_percent ?? 0}% payout</span>
                  {!!cleaner.hourly_rate && (
                    <span>${cleaner.hourly_rate}/hr</span>
                  )}
                </div>
              </div>

              {/* Delete button */}
              {canManage && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteRequest(cleaner.id, getFullName(cleaner));
                  }}
                  className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Delete cleaner"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
