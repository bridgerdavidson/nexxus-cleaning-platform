/**
 * Format a time string (HH:mm or HH:mm:ss) to 12-hour format (h:mm AM/PM).
 * Used for consistent display of appointment and other times across the app.
 */
export function formatTimeTo12h(timeStr: string): string {
  if (!timeStr || typeof timeStr !== "string") return "—";
  const parts = timeStr.trim().split(":");
  const hours = parts[0];
  const minutes = parts[1] ?? "00";
  const hour = parseInt(hours, 10);
  if (Number.isNaN(hour)) return timeStr;
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  const mins = minutes.replace(/\D/g, "").padStart(2, "0").slice(0, 2);
  return `${displayHour}:${mins} ${ampm}`;
}

/**
 * Format a date (YYYY-MM-DD) to a short "MM/DD/YY" string. Parses the parts
 * manually so it never shifts across a timezone boundary the way `new Date(str)`
 * can. Returns an empty string for malformed input.
 */
export function formatDateShort(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return "";
  const twoDigitYear = year % 100;
  return `${month.toString().padStart(2, "0")}/${day
    .toString()
    .padStart(2, "0")}/${twoDigitYear.toString().padStart(2, "0")}`;
}

/**
 * Format date (YYYY-MM-DD) and time (HH:mm or HH:mm:ss) to "Mon DD, YYYY at h:mm AM/PM".
 */
export function formatDateTimeTo12h(date: string, time: string): string {
  if (!date || typeof date !== "string") return formatTimeTo12h(time);
  const [y, m, d] = date.split("-").map(Number);
  const localDate = new Date(y, (m ?? 1) - 1, d ?? 1);
  const formattedDate = localDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${formattedDate} at ${formatTimeTo12h(time)}`;
}
