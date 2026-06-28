// React-free: who "the office" is for a cleaner, and a deterministic default.
import type { OrganizationMember } from "@/hooks/useOrganizationMembers";
import { rolesUserCanMessage } from "@/lib/messagingPermissions";
import type { UserRole } from "@/types";

export interface OfficeContact {
  id: string;
  name: string;
  role: UserRole;
  orgRole: string;
  avatarUrl: string | null;
}

// A cleaner may message admin + manager (mirrors the server can_message_role gate).
const OFFICE_ROLES = new Set<UserRole>(rolesUserCanMessage("cleaner"));

function toOffice(m: OrganizationMember): OfficeContact {
  const name =
    [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.email || "Office";
  return {
    id: m.id,
    name,
    role: m.role as UserRole,
    orgRole: m.org_role,
    avatarUrl: m.avatar_url,
  };
}

/** The office = the org's admins and managers. */
export function filterOfficeContacts(members: OrganizationMember[]): OfficeContact[] {
  return members.filter((m) => OFFICE_ROLES.has(m.role as UserRole)).map(toOffice);
}

/**
 * Deterministic single "office" recipient for the one-tap shortcut:
 * org owner -> first admin -> first manager. Null when the org has no office.
 * This is only the default; the cleaner can always pick a specific person.
 */
export function resolvePrimaryOfficeContact(members: OrganizationMember[]): OfficeContact | null {
  const office = filterOfficeContacts(members);
  return (
    office.find((o) => o.orgRole === "owner") ??
    office.find((o) => o.role === "admin") ??
    office.find((o) => o.role === "manager") ??
    null
  );
}
