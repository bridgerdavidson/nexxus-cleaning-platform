'use client';

import { Switch } from '@/components/ui/switch';
import {
  MANAGER_FLAGS,
  MANAGER_FLAG_GROUPS,
  type ManagerPermissions,
} from '@/lib/permissions/managerFlags';

interface ManagerPermissionEditorProps {
  value: ManagerPermissions;
  onChange: (next: ManagerPermissions) => void;
  disabled?: boolean;
}

/**
 * Shared, registry-driven manager-permission editor. Renders every flag in
 * `MANAGER_FLAGS`, grouped by `MANAGER_FLAG_GROUPS`, as a labeled Switch row.
 *
 * This is the single source of truth for how the 14 manager permission flags
 * are grouped and labeled in the UI. It backs three call sites: the legacy
 * settings editor (`ManagerPermissionsForm`), the redesign staff detail sheet
 * (`StaffDetailSheet`), and the invite-time collapsible editor
 * (`AddTeamMemberModal`). Add a flag to the registry and all three pick it up
 * automatically.
 */
export function ManagerPermissionEditor({ value, onChange, disabled }: ManagerPermissionEditorProps) {
  return (
    <div className="space-y-4">
      {MANAGER_FLAG_GROUPS.map((group) => {
        const flags = MANAGER_FLAGS.filter((f) => f.group === group);
        if (flags.length === 0) return null;
        return (
          <div key={group} className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground">{group}</h4>
            <div className="space-y-1">
              {flags.map((flag) => (
                <label
                  key={flag.key}
                  className="flex cursor-pointer items-start justify-between gap-3 rounded-control px-1 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{flag.label}</span>
                    <span className="block text-xs text-muted-foreground">{flag.description}</span>
                  </span>
                  <Switch
                    checked={value[flag.key]}
                    onCheckedChange={(next) => onChange({ ...value, [flag.key]: next })}
                    disabled={disabled}
                    aria-label={flag.label}
                  />
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
