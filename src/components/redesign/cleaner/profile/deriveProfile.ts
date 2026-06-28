import type { ProfileNameLike } from "./profile-types";

/** Display name from a name shim, e.g. "Maria Alvarez", "Maria", or a generic
 *  fallback when nothing is set. */
export function cleanerDisplayName(p: ProfileNameLike): string {
  const name = [p.firstName, p.lastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || "Your profile";
}

/** Up-to-two-letter initials for the avatar fallback, uppercased. */
export function cleanerInitials(p: ProfileNameLike): string {
  const f = (p.firstName ?? "").trim();
  const l = (p.lastName ?? "").trim();
  const initials = `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
  return initials || "U";
}

/** The Availability section is an employee-model placeholder. */
export function showAvailabilityPlaceholder(model?: string): boolean {
  return model === "hourly_external";
}
