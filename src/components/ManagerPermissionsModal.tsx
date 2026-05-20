"use client";

import React, { useState, useEffect } from "react";
import { X, Settings, Loader2, Check } from "lucide-react";
import {
  updateManagerPermissions,
  ManagerPermissions,
} from "../hooks/useAdminData";
import { useAuth } from "../hooks/useAuth";
import { TeamMember } from "../hooks/useAdminData";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface ManagerPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  manager: TeamMember | null;
  onPermissionsUpdated?: () => void;
}

export default function ManagerPermissionsModal({
  isOpen,
  onClose,
  manager,
  onPermissionsUpdated,
}: ManagerPermissionsModalProps) {
  const { currentOrganizationId } = useAuth();

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  const [permissions, setPermissions] = useState<ManagerPermissions>({
    can_view_customers: false,
    can_edit_customers: false,
    can_view_bookings: false,
    can_edit_bookings: false,
    can_approve_decline_bookings: false,
    can_manage_cleaners: false,
    can_view_properties: false,
    can_edit_properties: false,
    can_view_analytics: false,
    can_view_payments: false,
    can_manage_payments: false,
    can_view_messages: false,
    can_view_services: false,
    can_manage_services: false,
    can_handle_requests: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Load permissions when modal opens
  useEffect(() => {
    if (isOpen && manager?.permissions) {
      // Ensure all permission fields are defined, defaulting missing ones to false
      setPermissions({
        can_view_customers: manager.permissions.can_view_customers ?? false,
        can_edit_customers: manager.permissions.can_edit_customers ?? false,
        can_view_bookings: manager.permissions.can_view_bookings ?? false,
        can_edit_bookings: manager.permissions.can_edit_bookings ?? false,
        can_approve_decline_bookings:
          manager.permissions.can_approve_decline_bookings ?? false,
        can_manage_cleaners: manager.permissions.can_manage_cleaners ?? false,
        can_view_properties: manager.permissions.can_view_properties ?? false,
        can_edit_properties: manager.permissions.can_edit_properties ?? false,
        can_view_analytics: manager.permissions.can_view_analytics ?? false,
        can_view_payments: manager.permissions.can_view_payments ?? false,
        can_manage_payments: manager.permissions.can_manage_payments ?? false,
        can_view_messages: manager.permissions.can_view_messages ?? false,
        can_view_services: manager.permissions.can_view_services ?? false,
        can_manage_services: manager.permissions.can_manage_services ?? false,
        can_handle_requests: manager.permissions.can_handle_requests ?? false,
      });
      setHasChanges(false);
      setError("");
    }
  }, [isOpen, manager]);

  const handlePermissionChange = (key: keyof ManagerPermissions) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!manager || !currentOrganizationId) {
      setError("Missing manager or organization information");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const result = await updateManagerPermissions(
        manager.id,
        currentOrganizationId,
        permissions
      );

      if (result.success) {
        setHasChanges(false);
        if (onPermissionsUpdated) {
          onPermissionsUpdated();
        }
        onClose();
      } else {
        setError(result.error || "Failed to update permissions");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      if (
        confirm(
          "You have unsaved changes. Are you sure you want to close without saving?"
        )
      ) {
        setHasChanges(false);
        setError("");
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isOpen || !manager) return null;

  const permissionGroups = [
    {
      title: "Customer Management",
      permissions: [
        {
          key: "can_view_customers" as keyof ManagerPermissions,
          label: "View Customers",
          description: "View customer profiles and information",
        },
        {
          key: "can_edit_customers" as keyof ManagerPermissions,
          label: "Edit Customers",
          description: "Edit customer information and profiles",
        },
      ],
    },
    {
      title: "Booking Management",
      permissions: [
        {
          key: "can_view_bookings" as keyof ManagerPermissions,
          label: "View Bookings",
          description: "View all appointments and bookings",
        },
        {
          key: "can_edit_bookings" as keyof ManagerPermissions,
          label: "Edit Bookings",
          description: "Create, update, and manage appointments",
        },
        {
          key: "can_approve_decline_bookings" as keyof ManagerPermissions,
          label: "Approve/Decline Bookings",
          description: "Approve or decline pending appointment requests",
        },
      ],
    },
    {
      title: "Cleaner Management",
      permissions: [
        {
          key: "can_manage_cleaners" as keyof ManagerPermissions,
          label: "Manage Cleaners",
          description: "View and manage cleaner profiles",
        },
      ],
    },
    {
      title: "Property Management",
      permissions: [
        {
          key: "can_view_properties" as keyof ManagerPermissions,
          label: "View Properties",
          description: "View property information",
        },
        {
          key: "can_edit_properties" as keyof ManagerPermissions,
          label: "Edit Properties",
          description: "Edit property details and information",
        },
      ],
    },
    {
      title: "Analytics & Reports",
      permissions: [
        {
          key: "can_view_analytics" as keyof ManagerPermissions,
          label: "View Analytics",
          description: "Access analytics and reporting data",
        },
      ],
    },
    {
      title: "Payment Management",
      permissions: [
        {
          key: "can_view_payments" as keyof ManagerPermissions,
          label: "View Payments",
          description: "View payment information and history",
        },
        {
          key: "can_manage_payments" as keyof ManagerPermissions,
          label: "Manage Payments",
          description: "Process and manage payments",
        },
      ],
    },
    {
      title: "Messaging",
      permissions: [
        {
          key: "can_view_messages" as keyof ManagerPermissions,
          label: "View Messages",
          description: "View and access messaging system",
        },
      ],
    },
    {
      title: "Services",
      permissions: [
        {
          key: "can_view_services" as keyof ManagerPermissions,
          label: "View Services",
          description: "View service types and offerings",
        },
        {
          key: "can_manage_services" as keyof ManagerPermissions,
          label: "Manage Services",
          description: "Create, edit, and delete service types",
        },
      ],
    },
    {
      title: "Booking Requests",
      permissions: [
        {
          key: "can_handle_requests" as keyof ManagerPermissions,
          label: "Handle Booking Requests",
          description: "Open Awaiting Requests, assign cleaners, and force-assign on escalation",
        },
      ],
    },
  ];

  const enabledCount = Object.values(permissions).filter(Boolean).length;
  const totalCount = Object.keys(permissions).length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 animate-slide-up max-h-[90vh] overflow-y-auto">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-100 rounded-full">
                <Settings className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  Manage Permissions
                </h2>
                <p className="text-gray-600">
                  {manager.user_profile?.first_name}{" "}
                  {manager.user_profile?.last_name}
                </p>
              </div>
            </div>
            <div className="mt-4 p-3 bg-primary-50 rounded-lg">
              <p className="text-sm text-primary-700">
                <span className="font-semibold">{enabledCount}</span> of{" "}
                <span className="font-semibold">{totalCount}</span> permissions
                enabled
              </p>
            </div>
          </div>

          {/* Permissions List */}
          <div className="space-y-6 mb-6">
            {permissionGroups.map((group) => (
              <div
                key={group.title}
                className="border-b border-gray-200 pb-6 last:border-0 last:pb-0"
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  {group.title}
                </h3>
                <div className="space-y-3">
                  {group.permissions.map((permission) => (
                    <label
                      key={permission.key}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <div className="relative flex-shrink-0 mt-0.5">
                        <input
                          type="checkbox"
                          checked={permissions[permission.key]}
                          onChange={() =>
                            handlePermissionChange(permission.key)
                          }
                          className="sr-only"
                        />
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            permissions[permission.key]
                              ? "bg-primary-600 border-primary-600"
                              : "bg-white border-gray-300"
                          }`}
                        >
                          {permissions[permission.key] && (
                            <Check className="w-3 h-3 text-white" />
                          )}
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {permission.label}
                        </div>
                        <div className="text-sm text-gray-600">
                          {permission.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              disabled={isSaving}
              className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Permissions</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
