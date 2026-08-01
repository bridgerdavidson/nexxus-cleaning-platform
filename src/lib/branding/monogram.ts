/** Words that never deserve a monogram letter ("Maids of the Valley" -> MV). */
const CONNECTORS = new Set(["of", "the", "and", "&"]);

/**
 * Org name -> initials for the monogram fallback (docs/white-label-branding.md
 * decision 2: the universal fallback when no logo is uploaded).
 *
 * First letter of the first two meaningful words; a single word contributes its
 * first two letters; a name made ONLY of connector words falls back to its
 * literal first word so the mark is never empty; "?" for a blank name.
 */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const meaningful = words.filter((w) => !CONNECTORS.has(w.toLowerCase()));
  if (meaningful.length === 0) return words[0].slice(0, 2).toUpperCase();
  if (meaningful.length === 1) return meaningful[0].slice(0, 2).toUpperCase();
  return (meaningful[0][0] + meaningful[1][0]).toUpperCase();
}
