/**
 * Join a user's first/last name into a display string. Tolerant of nulls so it
 * can run on partial profile rows. Returns an empty string when nothing is
 * available so callers can decide their own fallback (e.g. an org name).
 */
export function formatUserName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}
