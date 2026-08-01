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

  // Code points, not code units: string indexing splits surrogate pairs, so an
  // emoji-led name like "🧹 Broom Co" would render a broken half-glyph.
  const first = (w: string, n = 1) => Array.from(w).slice(0, n).join("");

  const meaningful = words.filter((w) => !CONNECTORS.has(w.toLowerCase()));
  if (meaningful.length === 0) return first(words[0], 2).toUpperCase();
  if (meaningful.length === 1) return first(meaningful[0], 2).toUpperCase();
  return (first(meaningful[0]) + first(meaningful[1])).toUpperCase();
}
