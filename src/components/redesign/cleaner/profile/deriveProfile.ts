import { personInitials } from "@/lib/initials";
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

/** Up-to-two-letter initials for the avatar fallback, uppercased ("U" fallback). */
export function cleanerInitials(p: ProfileNameLike): string {
  return personInitials(p.firstName, p.lastName) || "U";
}

/** The Availability section is an employee-model placeholder. */
export function showAvailabilityPlaceholder(model?: string): boolean {
  return model === "hourly_external";
}
