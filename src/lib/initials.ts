/** Up to two uppercase initials from a person's first/last name. Returns "" when
 *  neither name is present (callers that render the initials should supply their
 *  own fallback, e.g. `personInitials(a, b) || "U"`). */
export function personInitials(first?: string | null, last?: string | null): string {
  const a = (first ?? "").trim();
  const b = (last ?? "").trim();
  return `${a.charAt(0)}${b.charAt(0)}`.toUpperCase();
}
