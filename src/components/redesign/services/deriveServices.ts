import type { ServiceSort, ServiceStatusFilter } from "./services-types";
import { compareChecklists, type ChecklistOrderKey } from "@/lib/checklistOrder";

// Pure formatting + filter/sort for the Operator Services screen. No React or
// data-layer dependency, so it is unit-tested in isolation. Generic over the
// record shape so the container gets its concrete arrays back unchanged.

export function formatPrice(n: number): string {
  const v = Number(n) || 0;
  const digits = Number.isInteger(v) ? 0 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

/** Compact list label: base, or "base+" when paid add-on tiers exist. */
export function rowPriceLabel(base: number, maxAdder: number): string {
  return maxAdder > 0 ? `${formatPrice(base)}+` : formatPrice(base);
}

/** Detail label: base, or "base to (base+max)". Never a dash (CLAUDE.md copy rule). */
export function priceRangeLabel(base: number, maxAdder: number): string {
  return maxAdder > 0 ? `${formatPrice(base)} to ${formatPrice(base + maxAdder)}` : formatPrice(base);
}

export function priceAdderLabel(adder: number): string {
  return `+${formatPrice(Number(adder) || 0)}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function serviceTypeLabel(raw: string): string {
  return (raw ?? "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

type ServiceLike = {
  name: string;
  description?: string | null;
  base_price: number;
  service_type: string;
  is_active: boolean;
  updated_at: string;
};

export function filterServices<T extends ServiceLike>(
  list: T[],
  opts: { search: string; status: ServiceStatusFilter },
): T[] {
  const q = opts.search.trim().toLowerCase();
  return list.filter((s) => {
    if (opts.status === "active" && !s.is_active) return false;
    if (opts.status === "inactive" && s.is_active) return false;
    if (!q) return true;
    const hay = [s.name, s.service_type, s.description ?? ""].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function sortServices<T extends ServiceLike>(list: T[], sort: ServiceSort): T[] {
  const copy = [...list];
  switch (sort) {
    case "recent":
      copy.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      break;
    case "price":
      copy.sort((a, b) => (a.base_price ?? 0) - (b.base_price ?? 0));
      break;
    case "name":
    default:
      copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
  }
  return copy;
}

/** Locked canonical tier order (cheapest first; see compareChecklists). Returns a NEW array. */
export function sortChecklists<T extends ChecklistOrderKey>(list: T[]): T[] {
  return [...list].sort(compareChecklists);
}
