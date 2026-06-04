/**
 * Produce a short, human label for a property: the property name if it has one,
 * else the street address (with city when present). Returns an empty string
 * when nothing is available so callers can decide their own fallback.
 *
 * Mirrors the inline `property.name || \`${address}, ${city}\`` pattern used in
 * AppointmentCard / AnalyticsPage, consolidated here.
 */
export function formatPropertyLabel(
  name: string | null | undefined,
  address?: string | null,
  city?: string | null,
): string {
  const trimmedName = (name ?? "").trim();
  if (trimmedName) return trimmedName;
  const trimmedAddress = (address ?? "").trim();
  if (trimmedAddress) {
    const trimmedCity = (city ?? "").trim();
    return trimmedCity ? `${trimmedAddress}, ${trimmedCity}` : trimmedAddress;
  }
  return "";
}
