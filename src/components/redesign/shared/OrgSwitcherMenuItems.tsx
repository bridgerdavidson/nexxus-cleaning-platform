"use client";

import { Check } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";

/**
 * Account-menu organization switcher (docs/white-label-branding.md decision 7).
 *
 * Renders nothing for single-org users, so the menu stays untouched for the
 * overwhelmingly common case. Lives in the account menu of EVERY role shell so
 * a switch is always reversible: any org you can land in has this menu, unlike
 * a settings section whose visibility depends on your role in the current org.
 * The current org's item is disabled, so re-selecting it can never reload.
 */
export function OrgSwitcherMenuItems() {
  const { availableOrganizations, currentOrganizationId, switchOrganization } = useAuth();
  if (!availableOrganizations || availableOrganizations.length < 2) return null;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Organization
      </DropdownMenuLabel>
      {availableOrganizations.map((o) => {
        const current = o.id === currentOrganizationId;
        return (
          <DropdownMenuItem
            key={o.id}
            disabled={current}
            onClick={() => switchOrganization(o.id)}
          >
            <Check className={current ? "h-4 w-4 shrink-0" : "h-4 w-4 shrink-0 opacity-0"} aria-hidden />
            <span className="truncate">{o.name}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
