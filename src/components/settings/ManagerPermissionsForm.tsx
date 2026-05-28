'use client';

import { useEffect, useState } from 'react';
import { Check, CheckCircle, Loader2, Save } from 'lucide-react';
import {
  updateManagerPermissions,
  type ManagerPermissions,
  type TeamMember,
} from '@/hooks/useAdminData';
import { useAuth } from '@/hooks/useAuth';

const ALL_FALSE: ManagerPermissions = {
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
};

const PERMISSION_GROUPS: {
  title: string;
  permissions: { key: keyof ManagerPermissions; label: string; description: string }[];
}[] = [
  {
    title: 'Customer Management',
    permissions: [
      { key: 'can_view_customers', label: 'View Customers', description: 'View customer profiles and information' },
      { key: 'can_edit_customers', label: 'Edit Customers', description: 'Edit customer information and profiles' },
    ],
  },
  {
    title: 'Booking Management',
    permissions: [
      { key: 'can_view_bookings', label: 'View Bookings', description: 'View all appointments and bookings' },
      { key: 'can_edit_bookings', label: 'Edit Bookings', description: 'Create, update, and manage appointments' },
      { key: 'can_approve_decline_bookings', label: 'Approve/Decline Bookings', description: 'Approve or decline pending appointment requests' },
    ],
  },
  {
    title: 'Cleaner Management',
    permissions: [
      { key: 'can_manage_cleaners', label: 'Manage Cleaners', description: 'View and manage cleaner profiles' },
    ],
  },
  {
    title: 'Property Management',
    permissions: [
      { key: 'can_view_properties', label: 'View Properties', description: 'View property information' },
      { key: 'can_edit_properties', label: 'Edit Properties', description: 'Edit property details and information' },
    ],
  },
  {
    title: 'Analytics & Reports',
    permissions: [
      { key: 'can_view_analytics', label: 'View Analytics', description: 'Access analytics and reporting data' },
    ],
  },
  {
    title: 'Payment Management',
    permissions: [
      { key: 'can_view_payments', label: 'View Payments', description: 'View payment information and history' },
      { key: 'can_manage_payments', label: 'Manage Payments', description: 'Process and manage payments' },
    ],
  },
  {
    title: 'Messaging',
    permissions: [
      { key: 'can_view_messages', label: 'View Messages', description: 'View and access messaging system' },
    ],
  },
  {
    title: 'Services',
    permissions: [
      { key: 'can_view_services', label: 'View Services', description: 'View service types and offerings' },
      { key: 'can_manage_services', label: 'Manage Services', description: 'Create, edit, and delete service types' },
    ],
  },
  {
    title: 'Booking Requests',
    permissions: [
      { key: 'can_handle_requests', label: 'Handle Booking Requests', description: 'Open Awaiting Requests, assign cleaners, and force-assign on escalation' },
    ],
  },
];

interface ManagerPermissionsFormProps {
  manager: TeamMember;
  onSaved?: () => void;
}

/**
 * Manager-permissions editor. Lives at /settings/team/[managerId] (replacement
 * for the legacy modal). Mirrors the modal's 15 toggles + Save behavior but
 * renders inline on the page rather than in an overlay.
 */
export default function ManagerPermissionsForm({ manager, onSaved }: ManagerPermissionsFormProps) {
  const { currentOrganizationId } = useAuth();

  const [permissions, setPermissions] = useState<ManagerPermissions>(ALL_FALSE);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (manager.permissions) {
      const next: ManagerPermissions = { ...ALL_FALSE };
      for (const k of Object.keys(next) as (keyof ManagerPermissions)[]) {
        next[k] = manager.permissions[k] ?? false;
      }
      setPermissions(next);
    } else {
      setPermissions(ALL_FALSE);
    }
    setHasChanges(false);
    setError(null);
    setSavedAt(null);
  }, [manager.id, manager.permissions]);

  function toggle(key: keyof ManagerPermissions) {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
    setHasChanges(true);
    setSavedAt(null);
  }

  async function save() {
    if (!currentOrganizationId) {
      setError('Missing organization context');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const result = await updateManagerPermissions(manager.id, currentOrganizationId, permissions);
      if (result.success) {
        setHasChanges(false);
        setSavedAt(Date.now());
        onSaved?.();
      } else {
        setError(result.error || 'Failed to update permissions');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      setIsSaving(false);
    }
  }

  const enabledCount = Object.values(permissions).filter(Boolean).length;
  const totalCount = Object.keys(permissions).length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-primary-100 bg-primary-50 p-4">
        <p className="text-sm text-primary-800">
          <span className="font-semibold">{enabledCount}</span> of{' '}
          <span className="font-semibold">{totalCount}</span> permissions enabled
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        {PERMISSION_GROUPS.map((group, idx) => (
          <div
            key={group.title}
            className={`px-5 py-5 ${idx === 0 ? '' : 'border-t border-gray-100'}`}
          >
            <h3 className="text-base font-semibold text-gray-900 mb-3">{group.title}</h3>
            <div className="space-y-2">
              {group.permissions.map((p) => {
                const on = permissions[p.key];
                return (
                  <label
                    key={p.key}
                    className="flex items-start gap-3 rounded-lg p-2 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p.key)}
                      className="sr-only"
                    />
                    <div
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                        on ? 'bg-primary-600 border-primary-600' : 'bg-white border-gray-300'
                      }`}
                    >
                      {on && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{p.label}</div>
                      <div className="text-xs text-gray-500">{p.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {savedAt && !hasChanges && (
        <p className="flex items-center gap-1.5 text-sm text-green-700">
          <CheckCircle className="w-4 h-4" /> Saved
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={save}
            disabled={isSaving || !hasChanges}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Saving…' : 'Save permissions'}
          </button>
        </div>
      </div>
    </div>
  );
}
