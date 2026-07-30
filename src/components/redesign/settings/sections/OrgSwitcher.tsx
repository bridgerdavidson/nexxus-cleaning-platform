"use client";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingRow } from "../SettingRow";

/** Only rendered when the signed-in user belongs to more than one organization. */
export function OrgSwitcher() {
  const { availableOrganizations, currentOrganizationId, switchOrganization } = useAuth();
  if (!availableOrganizations || availableOrganizations.length < 2) return null;

  return (
    <SettingRow
      label="Current organization"
      htmlFor="org-switch"
      helper="You belong to more than one company. Switching reloads the app."
    >
      <Select value={currentOrganizationId ?? undefined} onValueChange={switchOrganization}>
        <SelectTrigger id="org-switch" className="sm:w-72">
          <SelectValue placeholder="Select an organization" />
        </SelectTrigger>
        <SelectContent>
          {availableOrganizations.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
