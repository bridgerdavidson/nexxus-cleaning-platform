import { UserRole } from "../types";

const ALLOWED: Record<UserRole, UserRole[]> = {
  admin: ["admin", "manager", "cleaner", "homeowner"],
  manager: ["admin", "manager", "cleaner", "homeowner"],
  cleaner: ["admin", "manager"],
  homeowner: ["admin", "manager"],
};

export function rolesUserCanMessage(role: UserRole): UserRole[] {
  return ALLOWED[role] ?? [];
}

export function canMessageRole(viewer: UserRole, target: UserRole): boolean {
  return rolesUserCanMessage(viewer).includes(target);
}

export const MESSAGING_FORBIDDEN_TEXT =
  "You can't message that user.";

// Postgres raises 42501 from the can_message_user gate in
// supabase/migrations/052_messaging_permissions.sql.
export function isMessagingForbiddenError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "42501") return true;
  return typeof e.message === "string" && e.message.toLowerCase().includes("forbidden");
}
