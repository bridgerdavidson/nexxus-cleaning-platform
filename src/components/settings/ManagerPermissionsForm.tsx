'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Loader2, Save } from 'lucide-react';
import {
  updateManagerPermissions,
  type ManagerPermissions,
  type TeamMember,
} from '@/hooks/useAdminData';
import { emptyManagerPermissions } from '@/lib/permissions/managerFlags';
import { useAuth } from '@/hooks/useAuth';
import { ManagerPermissionEditor } from './ManagerPermissionEditor';

interface ManagerPermissionsFormProps {
  manager: TeamMember;
  onSaved?: () => void;
}

/**
 * Manager-permissions editor. Lives at /settings/team/[managerId] (replacement
 * for the legacy modal). Mirrors the modal's 14 toggles + Save behavior but
 * renders inline on the page rather than in an overlay.
 */
export default function ManagerPermissionsForm({ manager, onSaved }: ManagerPermissionsFormProps) {
  const { currentOrganizationId } = useAuth();

  const [permissions, setPermissions] = useState<ManagerPermissions>(emptyManagerPermissions());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (manager.permissions) {
      const next = emptyManagerPermissions();
      for (const k of Object.keys(next) as (keyof ManagerPermissions)[]) {
        next[k] = manager.permissions[k] ?? false;
      }
      setPermissions(next);
    } else {
      setPermissions(emptyManagerPermissions());
    }
    setHasChanges(false);
    setError(null);
    setSavedAt(null);
  }, [manager.id, manager.permissions]);

  function handlePermissionsChange(next: ManagerPermissions) {
    setPermissions(next);
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

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <ManagerPermissionEditor
          value={permissions}
          onChange={handlePermissionsChange}
          disabled={isSaving}
        />
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
