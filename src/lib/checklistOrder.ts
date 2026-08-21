/**
 * Canonical, LOCKED display order for a service's checklists (tiers):
 * cheapest first (price_adder asc), ties in creation order, id as the final
 * stable tiebreak. Manual tier reordering was removed on pilot feedback
 * (2026-08-18): renaming or repricing a tier kept visibly shuffling the list
 * (the old order fell through to name), which read as "my checklist switched".
 * The order must be a pure function of price and age, never of edits.
 *
 * Within one service the effective booking price is base_price + price_adder,
 * so price_adder asc IS cheapest-to-most-expensive.
 */
export interface ChecklistOrderKey {
  id: string;
  price_adder?: number | string | null;
  created_at?: string | null;
}

export function compareChecklists(a: ChecklistOrderKey, b: ChecklistOrderKey): number {
  const priceDiff = Number(a.price_adder ?? 0) - Number(b.price_adder ?? 0);
  if (priceDiff !== 0) return priceDiff;
  // ISO timestamps compare chronologically as strings; missing sorts first.
  const created = (a.created_at ?? '').localeCompare(b.created_at ?? '');
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}
